import { describe, expect, it } from "vitest";
import { createWatcher, MAX_READ_BACKOFF_MS, readBackoffMs } from "../src/core/loop";
import type { StartupEvidence } from "../src/core/types";
import {
  clear,
  clock,
  events,
  fakeReads,
  fakeRequester,
  GUARDIAN,
  position,
  USDC,
  WNEAR,
} from "./fixture";

const USDC_UNIT = 10n ** 6n;
const TICK = 30_000;

function setup(startup: () => Promise<StartupEvidence> = clear, operatorReconciled?: string[]) {
  const c = clock();
  const { reads, state } = fakeReads(c.now);
  const req = fakeRequester();
  const ev = events();
  const watcher = createWatcher({
    guardians: [
      { target: { network: "testnet", guardianId: GUARDIAN }, requester: req.requester, startup },
    ],
    reads,
    clock: c,
    log: ev.log,
    ...(operatorReconciled ? { operatorReconciled } : {}),
  });
  /** Advance one interval and run that tick. */
  const step = async () => {
    c.t += TICK;
    await watcher.tick();
  };
  return { c, state, req, ev, watcher, step };
}

/** First tick checks startup evidence and reads; requests are enabled from the second tick. */
async function enabled() {
  const s = setup();
  await s.watcher.tick();
  expect(s.req.sent).toEqual([]);
  return s;
}

describe("watcher: deterministic decisions", () => {
  it("sends exactly one capped request when health is below the trigger", async () => {
    const s = await enabled();
    await s.step();
    // Target 15 000 bps needs 110 USDC; max_per_action caps it at 100 USDC.
    expect(s.req.sent).toEqual([100n * USDC_UNIT]);
    expect(s.ev.names()).toContain("request_sent");
  });

  it("does not request at the threshold and does one bp below it", async () => {
    const s = await enabled();
    s.state.debtUsdc = 250n; // exactly 11 400 bps
    s.state.over = { policy: { triggerHfBps: 11_400 } };
    await s.step();
    expect(s.req.sent).toEqual([]);
    expect(s.ev.list.at(-1)).toMatchObject({ act: false, reason: "health_at_or_above_trigger" });
    s.state.over = { policy: { triggerHfBps: 11_401 } };
    await s.step();
    expect(s.req.sent).toHaveLength(1);
  });

  it("refuses stale prices and logs the reason", async () => {
    const s = await enabled();
    s.state.position = (t) => {
      const p = position(t);
      const price = p.prices[WNEAR];
      if (price) p.prices[WNEAR] = { ...price, publishTimeMs: t - 61_000 };
      return p;
    };
    await s.step();
    expect(s.req.sent).toEqual([]);
    expect(s.ev.list.at(-1)).toMatchObject({ event: "evaluation_refused", reason: "stale_price" });
  });

  it("uses the Guardian's stricter price age, not only the engine default", async () => {
    const s = await enabled();
    s.state.position = (t) => {
      const p = position(t);
      const price = p.prices[USDC];
      if (price) p.prices[USDC] = { ...price, publishTimeMs: t - 90_000 }; // < 120 s engine limit
      return p;
    };
    await s.step();
    expect(s.req.sent).toEqual([]);
    expect(s.ev.list.at(-1)).toMatchObject({ reason: "stale_price" });
  });

  it("refuses a stale Guardian snapshot and a position from another account", async () => {
    const s = await enabled();
    s.state.over = { readAtMs: 0 };
    await s.step();
    expect(s.ev.list.at(-1)).toMatchObject({ reason: "stale_guardian_state" });
    s.state.over = {};
    s.state.position = (t) => ({ ...position(t), accountId: "alice.testnet" });
    await s.step();
    expect(s.ev.list.at(-1)).toMatchObject({ reason: "position_mismatch" });
    expect(s.req.sent).toEqual([]);
  });

  it.each([
    ["paused", { status: { status: "paused" as const } }, "not_active"],
    [
      "in flight",
      {
        status: {
          inFlight: {
            opId: 1n,
            amount: 1n,
            fee: 0n,
            startedNs: 0n,
            repayPhase: "repaying" as const,
          },
        },
      },
      "in_flight",
    ],
    [
      "cooling down",
      { status: { lastActionStartedNs: BigInt(1_800_000_000_000 + 30_000) * 1_000_000n } },
      "cooldown",
    ],
    ["at the lifetime cap", { reserve: { spentTotal: 499n * 10n ** 6n } }, "lifetime_cap_reached"],
  ])("holds when %s", async (_name, over, reason) => {
    const s = await enabled();
    s.state.over = over;
    await s.step();
    expect(s.req.sent).toEqual([]);
    expect(s.ev.list.at(-1)).toMatchObject({ act: false, reason });
  });
});

describe("watcher: no overlap and bounded backoff", () => {
  it("skips a tick while the previous poll for that Guardian is still running", async () => {
    const s = await enabled();
    let release = () => {};
    s.state.gate = new Promise<void>((r) => {
      release = r;
    });
    s.c.t += TICK;
    const slow = s.watcher.tick();
    s.c.t += TICK;
    await s.watcher.tick();
    expect(s.ev.names()).toContain("tick_skipped_busy");
    expect(s.state.guardianCalls).toBe(2); // first tick + the slow one; the skipped tick read nothing
    s.state.gate = null;
    release();
    await slow;
    expect(s.req.sent).toHaveLength(1);
  });

  it("backs off exponentially to a cap and resets after a successful read", async () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => readBackoffMs(n))).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      MAX_READ_BACKOFF_MS,
      MAX_READ_BACKOFF_MS,
    ]);
    const s = await enabled();
    s.state.fail = "guardian";
    await s.step(); // failure 1 → retry in 30 s
    await s.step(); // failure 2 → retry in 60 s
    const calls = s.state.guardianCalls;
    await s.step(); // inside the 60 s window: no read at all
    expect(s.state.guardianCalls).toBe(calls);
    expect(s.req.sent).toEqual([]);
    s.state.fail = null;
    await s.step();
    expect(s.watcher.status().guardians[0]).toMatchObject({
      consecutiveReadFailures: 0,
      retryAt: null,
    });
  });

  it("treats a failed position read like a failed Guardian read", async () => {
    const s = await enabled();
    s.state.fail = "position";
    await s.step();
    expect(s.ev.list.at(-1)).toMatchObject({ event: "read_failed", kind: "bad_response" });
    expect(s.req.sent).toEqual([]);
  });
});

describe("watcher: one unresolved request per Guardian (W1)", () => {
  it("never resends while a signed hash is pending or unknown, then waits one more tick", async () => {
    const s = await enabled();
    s.req.script.submit.push({ kind: "pending", hash: "h1" }); // broadcast timed out after signing
    await s.step();
    for (let i = 0; i < 5; i++) await s.step(); // lookups return unknown
    expect(s.req.sent).toHaveLength(1);
    expect(s.req.looked).toEqual(["h1", "h1", "h1", "h1", "h1"]);
    expect(s.watcher.status().guardians[0]?.pendingHash).toBe("h1");

    s.req.script.lookup.push({
      kind: "final",
      outcome: { outcome: "executed", opId: 7n, used: 100n, fee: 1n },
    });
    await s.step(); // terminal now, but no send on the reconciling tick
    expect(s.req.sent).toHaveLength(1);
    expect(s.ev.list).toContainEqual(
      expect.objectContaining({ event: "request_outcome", outcome: "executed", opId: "7" }),
    );
    await s.step();
    expect(s.req.sent).toHaveLength(2);
  });

  it("locks to read-only when the transport fails without a hash", async () => {
    const s = await enabled();
    s.req.script.submit.push("throw");
    await s.step();
    for (let i = 0; i < 3; i++) await s.step();
    expect(s.req.sent).toHaveLength(1);
    expect(s.watcher.status().guardians[0]).toMatchObject({
      requests: "read_only",
      readOnlyReason: "submission_uncertain",
    });
  });

  it("logs a contract rejection and does not retry until a full cooldown passes", async () => {
    const s = await enabled();
    s.req.script.submit.push({
      kind: "final",
      hash: "h1",
      outcome: { outcome: "rejected", opId: 3n, reason: "trigger_not_met" },
    });
    await s.step();
    expect(s.ev.list).toContainEqual(
      expect.objectContaining({ event: "request_outcome", reason: "trigger_not_met" }),
    );
    for (let i = 0; i < 9; i++) await s.step(); // 270 s < 300 s cooldown
    expect(s.req.sent).toHaveLength(1);
    expect(s.ev.list.at(-1)).toMatchObject({ reason: "rejection_hold" });
    await s.step(); // 300 s
    expect(s.req.sent).toHaveLength(2);
  });

  it("holds after a failed transaction instead of looping", async () => {
    const s = await enabled();
    s.req.script.submit.push({ kind: "failed", hash: "h1", detail: "Owner or watcher only" });
    await s.step();
    await s.step();
    expect(s.req.sent).toHaveLength(1);
  });
});

describe("watcher: restart", () => {
  it("stays read-only while startup evidence is uncertain, and keeps observing", async () => {
    const s = setup(async () => ({ kind: "uncertain", detail: "recent nonce unaccounted for" }));
    for (let i = 0; i < 4; i++) await s.step();
    expect(s.req.sent).toEqual([]);
    expect(s.watcher.status().guardians[0]).toMatchObject({
      requests: "read_only",
      readOnlyReason: "startup_uncertain",
      monitoring: "recent_observation",
    });
    expect(s.ev.names().filter((n) => n === "read_only")).toHaveLength(1);
  });

  it("enables requests once an operator has reconciled that Guardian", async () => {
    const s = setup(async () => ({ kind: "uncertain", detail: "x" }), [GUARDIAN]);
    await s.step();
    expect(s.req.sent).toHaveLength(1);
  });

  it("treats a throwing startup check as uncertain", async () => {
    const s = setup(async () => {
      throw new Error("rpc down");
    });
    await s.step();
    await s.step();
    expect(s.req.sent).toEqual([]);
  });
});

describe("watcher: heartbeat", () => {
  it("reports a stale observation during a read outage instead of claiming health", async () => {
    const s = await enabled();
    const lastRead = s.c.t;
    s.state.fail = "guardian";
    for (let i = 0; i < 4; i++) await s.step();
    const g = s.watcher.status().guardians[0];
    expect(g).toMatchObject({
      monitoring: "stale_observation",
      lastSuccessfulReadAt: lastRead,
      lastError: "rpc_unavailable",
    });
    expect(s.watcher.status().observedAt).toBe(s.c.t);
  });

  it("emits JSON-serialisable, secret-free events and status", async () => {
    const s = await enabled();
    await s.step();
    const text = JSON.stringify([s.ev.list, s.watcher.status()]);
    expect(text).not.toMatch(/ed25519:|secp256k1:|private|seed/i);
  });

  it("refuses duplicate Guardians and requesters bound elsewhere", () => {
    const c = clock();
    const { reads } = fakeReads(c.now);
    const req = fakeRequester();
    const g = { target: { network: "testnet" as const, guardianId: GUARDIAN }, startup: clear };
    expect(() =>
      createWatcher({
        guardians: [
          { ...g, requester: req.requester },
          { ...g, requester: req.requester },
        ],
        reads,
        clock: c,
        log: () => {},
      }),
    ).toThrow(/twice/);
    expect(() =>
      createWatcher({
        guardians: [{ ...g, requester: fakeRequester("mainnet").requester }],
        reads,
        clock: c,
        log: () => {},
      }),
    ).toThrow(/another Guardian or network/);
  });
});
