import { describe, expect, it } from "vitest";
import { readGuardian } from "../src/read";
import {
  ACTIVATE_MSG,
  activationPayload,
  CREATE_GUARDIAN_GAS,
  claimRefundPayload,
  createGuardianPayload,
  type FactoryInfo,
  OWNER_REGISTER_GAS,
  ownerRegisterPayload,
  REGISTRATION_ORDER,
} from "../src/tx/activation";
import { fakeClient, NOW, target, views } from "./fixture";

const NEAR = 10n ** 24n;
const factory: FactoryInfo = {
  factoryId: "factory.testnet",
  minFunding: 2_753_250n * 10n ** 18n, // 2.75325 NEAR
  maxFunding: 10n * NEAR,
  debtTokenId: "usdc.testnet",
  collateralTokenId: "wrap.testnet",
  lendingId: "rhea.testnet",
  feeRecipientId: "fees.testnet",
  activationFee: 5n,
};
const policy = {
  maxPerAction: 100n,
  lifetimeCap: 1000n,
  reserveFloor: 20n,
  triggerHfBps: 12_000,
  targetHfBps: 15_000,
  cooldownSec: 300,
  actionFee: 1n,
};
const owner = { ownerId: "alice.testnet", nowMs: NOW };

async function created(over: (v: ReturnType<typeof views>) => void = () => {}) {
  const data = views();
  data.get_status.status = "created";
  data.get_reserve = {
    reserve: "0",
    floor: "20",
    spendable: "0",
    lifetime_cap: "1000",
    spent_total: "0",
    lifetime_remaining: "1000",
  };
  data.get_history = [];
  over(data);
  const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
  if (!r.ok) throw new Error(`fixture: ${r.error.detail}`);
  return r.value;
}

describe("createGuardianPayload", () => {
  const create = (funding: bigint, creationPending = false, p = policy) =>
    createGuardianPayload(factory, p, funding, { ownerId: "alice.testnet", creationPending });

  it("calls create_guardian on the factory with the policy wire format, funding and 150 Tgas", () => {
    const r = create(3n * NEAR);
    expect(r).toEqual({
      ok: true,
      value: [
        {
          receiverId: "factory.testnet",
          actions: [
            {
              methodName: "create_guardian",
              args: {
                policy: {
                  max_per_action: "100",
                  lifetime_cap: "1000",
                  reserve_floor: "20",
                  trigger_hf_bps: 12000,
                  target_hf_bps: 15000,
                  cooldown_sec: 300,
                  action_fee: "1",
                },
              },
              gas: CREATE_GUARDIAN_GAS,
              deposit: 3n * NEAR,
            },
          ],
        },
      ],
    });
    expect(CREATE_GUARDIAN_GAS >= 145n * 10n ** 12n).toBe(true);
  });

  it("accepts the exact funding bounds and refuses one yocto outside them", () => {
    expect(create(factory.minFunding).ok).toBe(true);
    expect(create(factory.maxFunding).ok).toBe(true);
    expect(create(factory.minFunding - 1n)).toMatchObject({
      ok: false,
      error: { reason: expect.stringMatching(/below/) },
    });
    expect(create(factory.maxFunding + 1n)).toMatchObject({
      ok: false,
      error: { reason: expect.stringMatching(/above/) },
    });
  });

  it("refuses an invalid policy and a creation already in flight", () => {
    expect(create(3n * NEAR, false, { ...policy, triggerHfBps: 10_499 }).ok).toBe(false);
    expect(create(3n * NEAR, false, { ...policy, cooldownSec: 299 }).ok).toBe(false);
    expect(create(3n * NEAR, false, { ...policy, lifetimeCap: 99n }).ok).toBe(false);
    expect(create(3n * NEAR, true)).toMatchObject({
      ok: false,
      error: { reason: expect.stringMatching(/in flight/) },
    });
  });

  it("never emits an access-key action", () => {
    const r = create(3n * NEAR);
    expect(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(
      /AddKey|add_key|access_key/i,
    );
  });
});

describe("claimRefundPayload", () => {
  it("uses exactly 1 yocto and only when something is claimable", () => {
    expect(claimRefundPayload("factory.testnet", 7n)).toMatchObject({
      ok: true,
      value: [
        { receiverId: "factory.testnet", actions: [{ methodName: "claim_refund", deposit: 1n }] },
      ],
    });
    expect(claimRefundPayload("factory.testnet", 0n).ok).toBe(false);
  });
});

describe("ownerRegisterPayload", () => {
  it("registers lending, debt and collateral in order with 1 yocto from the owner", async () => {
    const g = await created();
    const ids = REGISTRATION_ORDER.map((t) => {
      const r = ownerRegisterPayload(g, t, 125n * 10n ** 21n, owner);
      if (!r.ok) throw new Error(r.error.kind);
      expect(r.value[0]).toMatchObject({
        receiverId: target.guardianId,
        actions: [
          {
            methodName: "owner_register",
            args: { storage_deposit: "125000000000000000000000" },
            gas: OWNER_REGISTER_GAS,
            deposit: 1n,
          },
        ],
      });
      const args = r.value[0]?.actions[0]?.args as { target_id?: string } | undefined;
      return args?.target_id;
    });
    expect(ids).toEqual(["rhea.testnet", "usdc.testnet", "wrap.testnet"]);
  });

  it("refuses foreign, stale, locked, already-active Guardians and a zero deposit", async () => {
    const g = await created();
    expect(ownerRegisterPayload(g, "lending", 0n, owner).ok).toBe(false);
    expect(
      ownerRegisterPayload(g, "lending", 1n, { ...owner, ownerId: "mallory.testnet" }).ok,
    ).toBe(false);
    expect(
      ownerRegisterPayload(g, "lending", 1n, { ...owner, nowMs: NOW + 120_001 }),
    ).toMatchObject({
      ok: false,
      error: { kind: "stale_snapshot" },
    });
    const active = await created((d) => {
      d.get_status.status = "active";
    });
    expect(ownerRegisterPayload(active, "lending", 1n, owner).ok).toBe(false);
  });
});

describe("activationPayload", () => {
  it("sends reserve + fee to the Guardian with the activate message", async () => {
    const g = await created();
    const r = activationPayload(g, 121n, { ...owner, factory });
    expect(r).toEqual({
      ok: true,
      value: {
        payload: [
          {
            receiverId: "usdc.testnet",
            actions: [
              {
                methodName: "ft_transfer_call",
                args: { receiver_id: target.guardianId, amount: "126", msg: ACTIVATE_MSG },
                gas: 100n * 10n ** 12n,
                deposit: 1n,
              },
            ],
          },
        ],
        reserve: 121n,
        fee: 5n,
        feeRecipientId: "fees.testnet",
        total: 126n,
        debtTokenId: "usdc.testnet",
      },
    });
    expect(ACTIVATE_MSG).toBe('{"activate":{}}');
  });

  it("requires floor + max per action + action fee, at the exact boundary", async () => {
    const g = await created();
    expect(activationPayload(g, 121n, owner).ok).toBe(true);
    expect(activationPayload(g, 120n, owner)).toMatchObject({
      ok: false,
      error: { kind: "invalid_amount" },
    });
  });

  it("binds the fee and recipient to the factory template that was shown", async () => {
    const g = await created();
    for (const changed of [
      { activationFee: 6n },
      { feeRecipientId: "other.testnet" },
      { debtTokenId: "usdt.testnet" },
    ])
      expect(
        activationPayload(g, 121n, { ...owner, factory: { ...factory, ...changed } }),
      ).toMatchObject({
        ok: false,
        error: { reason: expect.stringMatching(/factory template/) },
      });
  });

  it("refuses while an operation holds the lock", async () => {
    const g = await created((d) => {
      (d.get_status as Record<string, unknown>).in_flight = {
        op_id: "1",
        amount: "0",
        fee: "0",
        started_ns: "0",
        repay_phase: null,
      };
    });
    expect(activationPayload(g, 121n, owner)).toMatchObject({
      ok: false,
      error: { reason: "Operation in flight" },
    });
  });
});
