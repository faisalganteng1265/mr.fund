import type { GuardianPolicy, GuardianState } from "@mrfund/shared";
import { DEFAULT_TRIGGER_HF_BPS, MIN_TRIGGER_HF_BPS } from "@mrfund/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluateTrigger } from "../src/trigger";
import { baseSnapshot, NOW, USDC, WNEAR, wnearPrice } from "./helpers";

const SEC_NS = 1_000_000_000n;
const nowNs = BigInt(NOW) * 1_000_000n;

const policy: GuardianPolicy = {
  maxPerAction: 100_000_000n,
  lifetimeCap: 500_000_000n,
  reserveFloor: 50_000_000n,
  triggerHfBps: 12_000,
  targetHfBps: 15_000,
  cooldownSec: 300,
  actionFee: 1_000_000n,
};

const guardian: GuardianState = {
  status: "active",
  ownerId: "alice.testnet",
  watcherId: "watcher.testnet",
  debtTokenId: USDC,
  reserve: 1_000_000_000n,
  spentTotal: 0n,
  inFlight: null,
  lastActionStartedNs: 0n,
};

/** 250 USDC debt against $300 adjusted collateral: health = 285 / 250 = 11400 bps. */
const risky = () =>
  baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 250n * 10n ** 6n * 10n ** 12n }] });

function run(
  over: {
    p?: Partial<GuardianPolicy>;
    g?: Partial<GuardianState>;
    s?: ReturnType<typeof risky>;
  } = {},
) {
  return evaluateTrigger(
    over.s ?? risky(),
    { ...policy, ...over.p },
    { ...guardian, ...over.g },
    NOW,
  );
}

function acted(r: ReturnType<typeof run>) {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

describe("defaults (D28)", () => {
  it("keeps the trigger default above the contract minimum", () => {
    expect(DEFAULT_TRIGGER_HF_BPS).toBe(12_000);
    expect(MIN_TRIGGER_HF_BPS).toBe(10_500);
  });
});

describe("evaluateTrigger: whether to act", () => {
  it("acts when health is strictly below the trigger", () => {
    expect(acted(run()).act).toBe(true);
  });

  it("does not act at the threshold, and acts one bp above it", () => {
    expect(acted(run({ p: { triggerHfBps: 11_400 } }))).toEqual({
      act: false,
      reason: "health_at_or_above_trigger",
    });
    expect(acted(run({ p: { triggerHfBps: 11_401 } })).act).toBe(true);
  });

  it("does not act without debt", () => {
    expect(acted(run({ s: baseSnapshot({ borrowed: [] }) }))).toEqual({
      act: false,
      reason: "no_debt",
    });
  });

  it.each(["created", "paused", "deactivated"] as const)("does not act when %s", (status) => {
    expect(acted(run({ g: { status } }))).toEqual({ act: false, reason: "not_active" });
  });

  it("does not act while an action is in flight", () => {
    const inFlight = { opId: 1n, amount: 1n, fee: 0n };
    expect(acted(run({ g: { inFlight } }))).toEqual({ act: false, reason: "in_flight" });
  });

  it("respects the cooldown to the second: 299 s blocks, 300 s allows", () => {
    expect(acted(run({ g: { lastActionStartedNs: nowNs - 299n * SEC_NS } }))).toEqual({
      act: false,
      reason: "cooldown",
    });
    expect(acted(run({ g: { lastActionStartedNs: nowNs - 300n * SEC_NS } })).act).toBe(true);
  });

  it("refuses to decide on a stale price", () => {
    const s = risky();
    s.prices[WNEAR] = { ...wnearPrice, publishTimeMs: NOW - 120_001 };
    const r = run({ s });
    expect(r).toEqual({
      ok: false,
      error: { kind: "stale_price", tokenId: WNEAR, ageMs: 120_001, limitMs: 120_000 },
    });
  });

  it("honours a custom data-age limit all the way into sizing", () => {
    const s = risky();
    s.prices[WNEAR] = { ...wnearPrice, publishTimeMs: NOW - 6_000 };
    const r = evaluateTrigger(s, policy, guardian, NOW, { maxDataAgeMs: 5_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("stale_price");
  });

  it("reports no spendable reserve when reserve is at the floor plus the fee", () => {
    expect(acted(run({ g: { reserve: 51_000_000n } }))).toEqual({
      act: false,
      reason: "reserve_exhausted",
    });
    expect(acted(run({ g: { reserve: 10_000_000n } }))).toEqual({
      act: false,
      reason: "reserve_exhausted",
    });
  });

  it("reports a reached lifetime cap when cap minus spent leaves no room for the fee", () => {
    expect(acted(run({ g: { spentTotal: 499_000_000n } }))).toEqual({
      act: false,
      reason: "lifetime_cap_reached",
    });
  });
});

describe("evaluateTrigger: how much", () => {
  it("sizes to the target when no limit binds", () => {
    // 285 / d >= 1.5  =>  d <= 190  =>  repay 60 USDC
    expect(acted(run())).toEqual({ act: true, amount: 60_000_000n, binding: "target" });
  });

  it("sizes to the trigger when no target is set", () => {
    // 285 / d >= 1.2  =>  d <= 237.5  =>  repay 12.5 USDC
    expect(acted(run({ p: { targetHfBps: null } }))).toEqual({
      act: true,
      amount: 12_500_000n,
      binding: "target",
    });
  });

  it("is limited by max_per_action", () => {
    expect(acted(run({ p: { maxPerAction: 40_000_000n } }))).toEqual({
      act: true,
      amount: 40_000_000n,
      binding: "max_per_action",
    });
  });

  it("is limited by the spendable reserve above the floor, after the fee", () => {
    // reserve 100 - floor 50 - fee 1 = 49
    expect(acted(run({ g: { reserve: 100_000_000n } }))).toEqual({
      act: true,
      amount: 49_000_000n,
      binding: "spendable",
    });
  });

  it("is limited by the remaining lifetime cap, after the fee", () => {
    // cap 500 - spent 460 - fee 1 = 39
    expect(acted(run({ g: { spentTotal: 460_000_000n } }))).toEqual({
      act: true,
      amount: 39_000_000n,
      binding: "lifetime_cap",
    });
  });

  it("never exceeds the outstanding debt even for an extreme target", () => {
    const r = acted(
      run({
        p: {
          targetHfBps: Number.MAX_SAFE_INTEGER,
          maxPerAction: 10n ** 12n,
          lifetimeCap: 10n ** 12n,
        },
      }),
    );
    expect(r).toEqual({ act: true, amount: 250_000_000n, binding: "target" });
  });

  it("always respects every limit (property)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 400_000_000n }),
        fc.bigInt({ min: 0n, max: 2_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc.bigInt({ min: 0n, max: 100_000_000n }),
        fc.bigInt({ min: 0n, max: 5_000_000n }),
        (maxPerAction, reserve, spentTotal, reserveFloor, actionFee) => {
          const p = { maxPerAction, lifetimeCap: 1_000_000_000n, reserveFloor, actionFee };
          const r = acted(run({ p, g: { reserve, spentTotal } }));
          if (!r.act) return;
          expect(r.amount).toBeGreaterThan(0n);
          expect(r.amount).toBeLessThanOrEqual(maxPerAction);
          expect(r.amount + actionFee).toBeLessThanOrEqual(reserve - reserveFloor);
          expect(spentTotal + r.amount + actionFee).toBeLessThanOrEqual(1_000_000_000n);
          expect(r.amount).toBeLessThanOrEqual(250_000_000n);
        },
      ),
    );
  });
});
