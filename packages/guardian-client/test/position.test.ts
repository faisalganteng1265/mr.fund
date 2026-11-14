import { describe, expect, it } from "vitest";
import { readGuardian } from "../src/read";
import { COLLATERAL_MSG, guardianPositionPayload, POSITION_GAS } from "../src/tx/position";
import { fakeClient, NOW, target, views } from "./fixture";

const owner = { ownerId: "alice.testnet", nowMs: NOW };
async function snapshot(mutate: (v: ReturnType<typeof views>) => void = () => {}) {
  const data = views();
  mutate(data);
  const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
  if (!r.ok) throw new Error("fixture");
  return r.value;
}

describe("guardianPositionPayload", () => {
  it("collateral: the collateral token's ft_transfer_call to the Guardian with the collateral message", async () => {
    const r = guardianPositionPayload(await snapshot(), { kind: "collateral", amount: 7n }, owner);
    expect(r).toEqual({
      ok: true,
      value: [
        {
          receiverId: "wrap.testnet",
          actions: [
            {
              methodName: "ft_transfer_call",
              args: { receiver_id: target.guardianId, amount: "7", msg: COLLATERAL_MSG },
              gas: POSITION_GAS,
              deposit: 1n,
            },
          ],
        },
      ],
    });
    expect(COLLATERAL_MSG).toBe('{"collateral":{}}');
  });

  it("borrow and sweep: 1-yocto Guardian calls with the 300 Tgas the sandbox flow used", async () => {
    const g = await snapshot();
    expect(guardianPositionPayload(g, { kind: "borrow", amount: 9n }, owner)).toMatchObject({
      ok: true,
      value: [
        {
          receiverId: target.guardianId,
          actions: [
            { methodName: "owner_borrow", args: { amount: "9" }, gas: POSITION_GAS, deposit: 1n },
          ],
        },
      ],
    });
    for (const [token, id] of [
      ["debt_token", "usdc.testnet"],
      ["collateral_token", "wrap.testnet"],
    ] as const)
      expect(guardianPositionPayload(g, { kind: "sweep", token }, owner)).toMatchObject({
        ok: true,
        value: [{ actions: [{ methodName: "owner_sweep", args: { token_id: id }, deposit: 1n }] }],
      });
  });

  it("refuses a foreign owner, a stale or future snapshot, a created or locked Guardian", async () => {
    const g = await snapshot();
    const borrow = { kind: "borrow", amount: 1n } as const;
    expect(guardianPositionPayload(g, borrow, { ...owner, ownerId: "bob.testnet" }).ok).toBe(false);
    expect(guardianPositionPayload(g, borrow, { ...owner, nowMs: NOW + 120_001 })).toMatchObject({
      ok: false,
      error: { kind: "stale_snapshot" },
    });
    expect(guardianPositionPayload(g, borrow, { ...owner, nowMs: NOW - 1 }).ok).toBe(false);
    const created = await snapshot((v) => {
      v.get_status.status = "created";
    });
    expect(guardianPositionPayload(created, borrow, owner).ok).toBe(false);
    const locked = await snapshot((v) => {
      (v.get_status as Record<string, unknown>).in_flight = {
        op_id: "1",
        amount: "5",
        fee: "0",
        started_ns: "1",
        repay_phase: null,
      };
    });
    expect(guardianPositionPayload(locked, borrow, owner)).toMatchObject({
      ok: false,
      error: { reason: "Operation in flight" },
    });
  });

  it("refuses zero, negative, oversized and non-bigint amounts, unknown tokens and extra fields", async () => {
    const g = await snapshot();
    for (const amount of [0n, -1n, 1n << 128n, 5 as unknown as bigint])
      for (const kind of ["collateral", "borrow"] as const)
        expect(guardianPositionPayload(g, { kind, amount }, owner).ok).toBe(false);
    expect(
      guardianPositionPayload(g, { kind: "sweep", token: "reserve" as "debt_token" }, owner).ok,
    ).toBe(false);
    expect(
      guardianPositionPayload(
        g,
        { kind: "borrow", amount: 1n, receiver: "evil.testnet" } as never,
        owner,
      ).ok,
    ).toBe(false);
    expect(guardianPositionPayload(g, { kind: "withdraw_collateral" } as never, owner).ok).toBe(
      false,
    );
  });
});
