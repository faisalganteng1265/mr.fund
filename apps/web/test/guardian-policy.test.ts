import { guardianOwnerPayload } from "@mrfund/guardian-client";
import { err, type GuardianPolicy, type NearTransaction, ok } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import type { TransactionSigner } from "../src/execution/signer";
import { policyEditAvailability } from "../src/guardian/controls";
import { buildPolicyEdit } from "../src/guardian/flow";
import { createLiveGuardian, type LiveGuardianView } from "../src/guardian/live";
import {
  type GuardianExpectation,
  type GuardianIntent,
  verifyGuardianPayload,
} from "../src/guardian/verify";
import { createdViews, factory, NOW, OWNER, policy, snapshot, views } from "./guardian-fixture";

type Views = ReturnType<typeof views>;
const owner = { ownerId: OWNER, nowMs: NOW };
// The fixture Guardian runs 120% with a 150% target; 140% keeps that target valid.
const next: GuardianPolicy = { ...policy, triggerHfBps: 14_000 };
const deactivate = (v: Views) => {
  v.get_status.status = "deactivated";
};
const inFlight = (v: Views) => {
  Object.assign(v.get_status, {
    in_flight: {
      op_id: "3",
      amount: "5",
      fee: "0",
      started_ns: String(BigInt(NOW - 5000) * 1_000_000n),
      repay_phase: null,
    },
  });
};
const expectation = (
  guardian: GuardianExpectation["guardian"],
  over: Partial<GuardianExpectation> = {},
): GuardianExpectation => ({
  network: "testnet",
  session: { network: "testnet", accountId: OWNER },
  signerId: OWNER,
  factory,
  guardian,
  ...over,
});
const active = await snapshot();
const built = (g = active, p: GuardianPolicy = next) => {
  const b = buildPolicyEdit(g, p, owner);
  if (!b.ok) throw new Error(b.reason);
  return b;
};
const callOf = (p: NearTransaction[]) => {
  const call = p[0]?.actions[0];
  if (!call) throw new Error("fixture");
  return call;
};

describe("policyEditAvailability", () => {
  it("is open for an active or paused Guardian with a fresh read", async () => {
    expect(policyEditAvailability(active, NOW)).toEqual({ available: true, reason: null });
    const paused = await snapshot((v) => {
      v.get_status.status = "paused";
    });
    expect(policyEditAvailability(paused, NOW).available).toBe(true);
  });

  it.each<[string, (v: Views) => void, number, RegExp]>([
    ["a Guardian that is not active yet", createdViews, NOW, /Activate/],
    ["a deactivated Guardian", deactivate, NOW, /off/],
    ["an operation in flight", inFlight, NOW, /in flight/],
    ["a stale read", () => {}, NOW + 120_001, /Refresh/],
  ])("waits with the reason for %s", async (_name, change, nowMs, reason) => {
    const a = policyEditAvailability(await snapshot(change), nowMs);
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(reason);
  });
});

describe("buildPolicyEdit", () => {
  it("builds one set_policy call to the owner's own Guardian with 1 yocto and the exact policy", () => {
    const b = built();
    expect(b.intent).toEqual({ kind: "policy", policy: next });
    expect(b.payload).toHaveLength(1);
    expect(b.payload[0]?.receiverId).toBe(active.guardianId);
    expect(callOf(b.payload)).toMatchObject({ methodName: "set_policy", deposit: 1n });
  });

  it("refuses a different account, an in-flight Guardian, a stale read and a cap below the spend", async () => {
    expect(buildPolicyEdit(active, next, { ownerId: "bob.testnet", nowMs: NOW }).ok).toBe(false);
    expect(buildPolicyEdit(active, next, { ownerId: OWNER, nowMs: NOW + 120_001 })).toEqual({
      ok: false,
      reason: "Refresh the Guardian first.",
    });
    expect(buildPolicyEdit(await snapshot(inFlight), next, owner).ok).toBe(false);
    const spent = await snapshot((v) => {
      Object.assign(v.get_reserve, { spent_total: "500", lifetime_remaining: "500" });
    });
    expect(buildPolicyEdit(spent, { ...next, lifetimeCap: 499n }, owner).ok).toBe(false);
  });
});

describe("verifyGuardianPayload for a limits edit", () => {
  const intent: GuardianIntent = { kind: "policy", policy: next };
  const tampered = (mutate: (p: NearTransaction[]) => void) => {
    const copy = structuredClone(built().payload);
    mutate(copy);
    return copy;
  };

  it("accepts exactly what the builder emits", () => {
    const r = verifyGuardianPayload(built().payload, intent, expectation(active));
    expect(r.ok && r.value.intent).toBe("policy");
  });

  it.each<[string, (p: NearTransaction[]) => void]>([
    [
      "a trigger that differs from the review",
      (p) => Object.assign(callOf(p).args.policy ?? {}, { trigger_hf_bps: 10_500 }),
    ],
    [
      "a max per action that differs from the review",
      (p) => Object.assign(callOf(p).args.policy ?? {}, { max_per_action: "1000000" }),
    ],
    ["an extra argument", (p) => Object.assign(callOf(p).args, { watcher_id: "evil.testnet" })],
    [
      "another receiver",
      (p) => Object.assign(p[0] ?? {}, { receiverId: "other-guardian.testnet" }),
    ],
    ["a deposit other than 1 yocto", (p) => Object.assign(callOf(p), { deposit: 2n })],
  ])("refuses %s", (_name, mutate) => {
    expect(verifyGuardianPayload(tampered(mutate), intent, expectation(active)).ok).toBe(false);
  });

  it("refuses another signer, a Guardian not yet active, and one with an operation in flight", async () => {
    const payload = built().payload;
    const bob = { network: "testnet" as const, accountId: "bob.testnet" };
    const asBob = expectation(active, { signerId: "bob.testnet", session: bob });
    expect(verifyGuardianPayload(payload, intent, asBob).ok).toBe(false);
    const created = await snapshot(createdViews);
    expect(verifyGuardianPayload(payload, intent, expectation(created)).ok).toBe(false);
    const locked = await snapshot(inFlight);
    expect(verifyGuardianPayload(payload, intent, expectation(locked)).ok).toBe(false);
  });

  it("does not accept a limits payload under another intent, nor another payload as a limits edit", () => {
    const pause = guardianOwnerPayload(active, { kind: "pause" }, owner);
    if (!pause.ok) throw new Error("fixture");
    const asPause = verifyGuardianPayload(built().payload, { kind: "pause" }, expectation(active));
    expect(asPause.ok).toBe(false);
    expect(verifyGuardianPayload(pause.value, intent, expectation(active)).ok).toBe(false);
  });
});

describe("the store runs a limits edit through the verified wallet path", () => {
  const client = (data: Views) => ({
    async view(contractId: string, method: string) {
      const at = (d: unknown) => ok({ data: d, blockHeight: 1, blockHash: "block" });
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
          get_guardian: "guardian.testnet",
          is_pending: false,
          get_unclaimed: "0",
          get_next_guardian_id: "guardian.testnet",
        };
        return at(f[method]);
      }
      if (contractId === "guardian.testnet") return at(Reflect.get(data, method));
      if (method === "ft_metadata") return at({ symbol: "USDC", decimals: 6, spec: "ft-1.0.0" });
      return err({ kind: "bad_response" as const, detail: "unknown" });
    },
  });
  const wallet = (onSend: () => Promise<unknown>): TransactionSigner & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      accountId: OWNER,
      network: "testnet",
      calls,
      async signAndSend(v) {
        calls.push(v);
        return onSend();
      },
    };
  };
  const store = (data: Views, signer: TransactionSigner | null) =>
    createLiveGuardian({
      client: client(data),
      network: "testnet",
      factoryId: factory.factoryId,
      ownerId: OWNER,
      signer,
      now: () => NOW,
    });
  const guardianIn = (view: LiveGuardianView) => {
    const s = view.state;
    if (s.status !== "ready" || s.activation.kind !== "activated") throw new Error("fixture");
    return s.activation.guardian;
  };

  it("asks the wallet once and shows the chain's policy afterwards, not the wallet's answer", async () => {
    const data = views();
    const signer = wallet(async () => {
      Object.assign(data.get_policy, { trigger_hf_bps: 14_000 });
      return [];
    });
    const g = store(data, signer);
    await g.refresh();
    const before = guardianIn(g.getSnapshot());
    expect(before.policy.triggerHfBps).toBe(12_000);
    await g.run(buildPolicyEdit(before, next, owner));
    expect(signer.calls).toHaveLength(1);
    expect(guardianIn(g.getSnapshot()).policy.triggerHfBps).toBe(14_000);
  });

  it("a rejected wallet leaves the chain's old policy on screen and says so", async () => {
    const data = views();
    const g = store(
      data,
      wallet(async () => {
        throw new Error("rejected");
      }),
    );
    await g.refresh();
    await g.run(buildPolicyEdit(guardianIn(g.getSnapshot()), next, owner));
    expect(guardianIn(g.getSnapshot()).policy.triggerHfBps).toBe(12_000);
    expect(g.getSnapshot().notice).toMatch(/did not confirm/);
  });

  it("a session without a signer cannot send an edit", async () => {
    const g = store(views(), null);
    await g.refresh();
    await g.run(buildPolicyEdit(guardianIn(g.getSnapshot()), next, owner));
    expect(g.getSnapshot().notice).toMatch(/cannot sign/);
  });
});
