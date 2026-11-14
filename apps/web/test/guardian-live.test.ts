import { readActivationState } from "@mrfund/guardian-client";
import { err, ok } from "@mrfund/shared";
import { describe, expect, it, vi } from "vitest";
import type { TransactionSigner } from "../src/execution/signer";
import {
  controlAvailability,
  heartbeatState,
  historyNotice,
  inFlightNotice,
} from "../src/guardian/controls";
import {
  activationProgress,
  buildActivationStep,
  buildControl,
  nextActivationStep,
} from "../src/guardian/flow";
import { createLiveGuardian, parseTokenFacts, walletHashes } from "../src/guardian/live";
import { createdViews, factory, NOW, OWNER, policy, snapshot, views } from "./guardian-fixture";

type Chain = {
  guardian: string | null;
  pending: boolean;
  unclaimed: string;
  registered: Record<string, boolean>;
  views: ReturnType<typeof views>;
  down?: boolean;
};

const HASH = "7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv";

function chain(over: Partial<Chain> = {}): Chain {
  return {
    guardian: null,
    pending: false,
    unclaimed: "0",
    registered: {},
    views: views(),
    ...over,
  };
}

/** A fake RPC over factory, Guardian and token views; one block for everything. */
function fakeClient(c: Chain) {
  return {
    async view(contractId: string, method: string, args: unknown) {
      if (c.down) return err({ kind: "rpc_unavailable" as const, detail: "down" });
      const at = (data: unknown) => ok({ data, blockHeight: 123, blockHash: "block" });
      if (contractId === factory.factoryId) {
        const f: Record<string, unknown> = {
          get_template: {
            debt_token_id: factory.debtTokenId,
            collateral_token_id: factory.collateralTokenId,
            lending_id: factory.lendingId,
            fee_recipient_id: factory.feeRecipientId,
            activation_fee: factory.activationFee.toString(),
          },
          get_limits: {
            min_funding: factory.minFunding.toString(),
            max_funding: factory.maxFunding.toString(),
          },
          get_guardian: c.guardian,
          is_pending: c.pending,
          get_unclaimed: c.unclaimed,
          get_next_guardian_id: "guardian.testnet",
        };
        return at(f[method]);
      }
      if (contractId === "guardian.testnet")
        return at((c.views as Record<string, unknown>)[method]);
      if (method === "ft_metadata") return at({ symbol: "USDC", decimals: 6, spec: "ft-1.0.0" });
      if (method === "storage_balance_bounds")
        return at({ min: "1250000000000000000000", max: null });
      if (method === "storage_balance_of") {
        const who = (args as { account_id: string }).account_id;
        return at(c.registered[contractId] && who === "guardian.testnet" ? { total: "1" } : null);
      }
      return err({ kind: "bad_response" as const, detail: "unknown" });
    },
  };
}

function signer(result: () => Promise<unknown>): TransactionSigner & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    accountId: OWNER,
    network: "testnet",
    calls,
    async signAndSend(v) {
      calls.push(v);
      return result();
    },
  };
}

const live = (c: Chain, s: TransactionSigner | null) =>
  createLiveGuardian({
    client: fakeClient(c),
    network: "testnet",
    factoryId: factory.factoryId,
    ownerId: OWNER,
    signer: s,
    now: () => NOW,
  });

const state = async (c: Chain) => {
  const r = await readActivationState(
    fakeClient(c),
    { network: "testnet", factoryId: factory.factoryId },
    OWNER,
    { now: () => NOW },
  );
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
};

describe("activation resumes from chain at every step", () => {
  const createdChain = (registered: Record<string, boolean> = {}) => {
    const c = chain({ guardian: "guardian.testnet", registered });
    createdViews(c.views);
    return c;
  };
  it.each<[string, Chain, string]>([
    ["no Guardian", chain(), "create"],
    ["creation in flight", chain({ pending: true }), "wait_creation"],
    [
      "failed with a claimable refund",
      chain({ unclaimed: "2753250000000000000000000" }),
      "claim_refund",
    ],
    ["created, nothing registered", createdChain(), "register:lending"],
    ["lending registered", createdChain({ "rhea.testnet": true }), "register:debt_token"],
    [
      "both tokens next",
      createdChain({ "rhea.testnet": true, "usdc.testnet": true }),
      "register:collateral_token",
    ],
    [
      "all registered",
      createdChain({ "rhea.testnet": true, "usdc.testnet": true, "wrap.testnet": true }),
      "activate",
    ],
    ["active", chain({ guardian: "guardian.testnet" }), "done"],
  ])("%s → %s", async (_name, c, expected) => {
    const step = nextActivationStep(await state(c));
    expect(step.kind === "register" ? `register:${step.target}` : step.kind).toBe(expected);
  });

  it("a failed creation shows the refund amount and a claim, a sent refund shows none", async () => {
    const failed = await state(chain({ unclaimed: "7" }));
    expect(nextActivationStep(failed)).toEqual({ kind: "claim_refund", amount: 7n });
    const built = buildActivationStep(failed, { ownerId: OWNER, nowMs: NOW, factory });
    expect(built.ok && built.payload[0]?.actions[0]?.methodName).toBe("claim_refund");
    // `refund: sent` leaves nothing unclaimed: the owner simply starts again.
    expect(nextActivationStep(await state(chain()))).toEqual({ kind: "create" });
  });

  it("a creation known only by its hash shows no Guardian", async () => {
    const none = await state(chain());
    expect(activationProgress(none, { intent: "create", hashes: [HASH] })).toEqual({
      kind: "unresolved",
      hashes: [HASH],
    });
    const created = await state(createdChain());
    expect(activationProgress(created, { intent: "create", hashes: [HASH] })).toMatchObject({
      kind: "step",
      step: { kind: "register" },
    });
  });

  it("creation needs reviewed terms and uses the factory minimum funding", async () => {
    const none = await state(chain());
    expect(buildActivationStep(none, { ownerId: OWNER, nowMs: NOW, factory })).toEqual({
      ok: false,
      reason: "Review your policy first.",
    });
    const built = buildActivationStep(none, { ownerId: OWNER, nowMs: NOW, factory, policy });
    expect(built.ok && built.intent).toEqual({
      kind: "create",
      policy,
      funding: factory.minFunding,
    });
  });

  it("a stale Guardian read cannot build a step", async () => {
    const created = await state(createdChain());
    const built = buildActivationStep(created, {
      ownerId: OWNER,
      nowMs: NOW + 120_001,
      factory,
      storageDeposit: 1n,
    });
    expect(built).toEqual({ ok: false, reason: "Refresh the Guardian first." });
  });
});

describe("owner controls follow the contract's availability", () => {
  it("active: pause, deactivate and withdraw; no resume", async () => {
    const a = controlAvailability(await snapshot(), NOW);
    expect([
      a.pause.available,
      a.resume.available,
      a.deactivate.available,
      a.withdraw.available,
    ]).toEqual([true, false, true, true]);
  });
  it("deactivated: automation controls off, withdraw stays", async () => {
    const s = await snapshot((v) => {
      v.get_status.status = "deactivated";
    });
    const a = controlAvailability(s, NOW);
    expect(a.pause.available || a.resume.available || a.deactivate.available).toBe(false);
    expect(a.withdraw.available).toBe(true);
  });
  it("in flight: withdraw blocked with the reason; the lock is shown as unknown", async () => {
    const s = await snapshot((v) => {
      (v.get_status as Record<string, unknown>).in_flight = {
        op_id: "3",
        amount: "50",
        fee: "1",
        started_ns: String(BigInt(NOW - 5000) * 1_000_000n),
        repay_phase: "unresolved",
      };
    });
    const a = controlAvailability(s, NOW);
    expect(a.withdraw).toEqual({ available: false, reason: expect.stringMatching(/in flight/) });
    expect(inFlightNotice(s)).toMatch(/outcome is unknown/);
    expect(buildControl(s, "withdraw", { ownerId: OWNER, nowMs: NOW }).ok).toBe(false);
  });
  it("a stale snapshot disables every control", async () => {
    const a = controlAvailability(await snapshot(), NOW + 120_001);
    expect(
      Object.values(a).every((c) => !c.available && c.reason === "Refresh the Guardian first."),
    ).toBe(true);
  });
  it("history truncation and heartbeat age are stated, never invented", async () => {
    const full = await snapshot((v) => {
      (v as Record<string, unknown>).get_history = Array.from({ length: 50 }, (_, i) => ({
        op_id: String(i),
        at_ns: String(BigInt(NOW - 100_000 + i) * 1_000_000n),
        requested: "1",
        outcome: "rejected",
        reason: "cooldown",
        used: "0",
        fee: "0",
      }));
    });
    expect(historyNotice(full)).toMatch(/not retained/);
    expect(heartbeatState(null, NOW)).toEqual({ kind: "unavailable" });
    expect(heartbeatState(NOW - 125_000, NOW)).toEqual({ kind: "offline", ageMs: 125_000 });
    expect(heartbeatState(NOW + 1, NOW)).toEqual({ kind: "unavailable" });
  });
});

describe("live Guardian store", () => {
  it("reads factory, token and activation state; heartbeat is unavailable without a source", async () => {
    const g = live(chain(), null);
    await g.refresh();
    const v = g.getSnapshot();
    expect(v.state).toMatchObject({
      status: "ready",
      token: { symbol: "USDC", decimals: 6 },
      activation: { kind: "none" },
      heartbeat: { kind: "unavailable" },
    });
    expect(v.signBlocked).toMatch(/NEAR Auth/);
  });

  it("an Auth session never reaches a wallet", async () => {
    const g = live(chain(), null);
    await g.refresh();
    const s = await state(chain());
    await g.run(buildActivationStep(s, { ownerId: OWNER, nowMs: NOW, factory, policy }));
    expect(g.getSnapshot().notice).toMatch(/cannot sign/);
  });

  it("creation: wallet success alone shows no Guardian until the factory reports one", async () => {
    const c = chain();
    const s = signer(async () => [{ transaction: { hash: HASH } }]);
    const g = live(c, s);
    await g.refresh();
    const none = await state(c);
    await g.run(buildActivationStep(none, { ownerId: OWNER, nowMs: NOW, factory, policy }));
    expect(s.calls).toHaveLength(1);
    let v = g.getSnapshot();
    expect(
      v.state.status === "ready" && activationProgress(v.state.activation, v.submission),
    ).toEqual({
      kind: "unresolved",
      hashes: [HASH],
    });
    // The factory now reports the Guardian: the next read moves on and the submission clears.
    c.guardian = "guardian.testnet";
    createdViews(c.views);
    await g.refresh();
    v = g.getSnapshot();
    expect(v.submission).toBeNull();
    expect(v.state).toMatchObject({ activation: { kind: "created", next: "lending" } });
    expect(v.state.status === "ready" && v.state.storageDeposit).toBe(
      1_250_000_000_000_000_000_000n,
    );
  });

  it("a wallet error re-reads and keeps the creation unresolved, never done", async () => {
    const s = signer(async () => {
      throw new Error("User rejected");
    });
    const g = live(chain(), s);
    await g.refresh();
    const none = await state(chain());
    await g.run(buildActivationStep(none, { ownerId: OWNER, nowMs: NOW, factory, policy }));
    const v = g.getSnapshot();
    expect(v.notice).toMatch(/did not confirm/);
    expect(v.busy).toBe(false);
    expect(v.state).toMatchObject({ activation: { kind: "none" } });
  });

  it("a tampered payload is refused before the wallet", async () => {
    const s = signer(async () => []);
    const g = live(chain(), s);
    await g.refresh();
    const none = await state(chain());
    const built = buildActivationStep(none, { ownerId: OWNER, nowMs: NOW, factory, policy });
    if (!built.ok) throw new Error(built.reason);
    const payload = structuredClone(built.payload);
    (payload[0] as { receiverId: string }).receiverId = "evil.testnet";
    await g.run({ ...built, payload });
    expect(s.calls).toHaveLength(0);
    expect(g.getSnapshot().notice).toMatch(/factory/);
  });

  it("malformed or unavailable reads show unavailable", async () => {
    const down = live(chain({ down: true }), null);
    await down.refresh();
    expect(down.getSnapshot().state).toMatchObject({ status: "unavailable" });
    const c = chain({ guardian: "guardian.testnet" });
    (c.views.get_reserve as Record<string, unknown>).spendable = "999";
    const bad = live(c, null);
    await bad.refresh();
    expect(bad.getSnapshot().state).toEqual({
      status: "unavailable",
      reason: "The Guardian returned data that could not be validated.",
    });
  });

  it("parses token metadata and wallet hashes strictly", () => {
    expect(parseTokenFacts({ symbol: "<script>", decimals: 6 })).toBeNull();
    expect(parseTokenFacts({ symbol: "USDC", decimals: 6.5 })).toBeNull();
    expect(walletHashes([{ transaction: { hash: HASH } }, { transaction: { hash: "x" } }])).toEqual(
      [HASH],
    );
    expect(walletHashes(undefined)).toEqual([]);
  });

  it("ignores a superseded read", async () => {
    const c = chain();
    const g = live(c, null);
    const first = g.refresh();
    c.pending = true;
    const second = g.refresh();
    await Promise.all([first, second]);
    expect(g.getSnapshot().state).toMatchObject({ activation: { kind: "pending" } });
    vi.restoreAllMocks();
  });
});
