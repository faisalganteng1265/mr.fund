import { ok } from "@mrfund/shared";
import { expect, it } from "vitest";
import { dispatch, sourcesOf, toToolMessage } from "../src/dispatch";
import { baseSnapshot, NOW, USDC } from "./fixture";

function context(heartbeat?: () => Promise<unknown>) {
  const snapshot = baseSnapshot();
  const data: Record<string, unknown> = {
    get_config: {
      owner_id: "alice.testnet",
      watcher_id: "watcher.testnet",
      lending_id: snapshot.lendingId,
      oracle_id: "oracle.testnet",
      debt_token_id: USDC,
      collateral_token_ids: ["wrap.testnet"],
      fee_recipient_id: "fees.testnet",
      activation_fee: "50000",
      lending_version: "0.11.0",
      debt_extra_decimals: 12,
      collateral_extra_decimals: 0,
      collateral_price_id: "11".repeat(32),
      debt_price_id: "22".repeat(32),
      max_price_age_sec: 60,
    },
    get_status: {
      status: "active",
      owner_id: "alice.testnet",
      watcher_id: "watcher.testnet",
      lending_id: snapshot.lendingId,
      oracle_id: "oracle.testnet",
      debt_token_id: USDC,
      collateral_token_ids: ["wrap.testnet"],
      fee_recipient_id: "fees.testnet",
      in_flight: null,
      last_action_started_ns: "0",
    },
    get_policy: {
      max_per_action: "100000000",
      lifetime_cap: "1000000000",
      reserve_floor: "20000000",
      trigger_hf_bps: 12000,
      target_hf_bps: 15000,
      cooldown_sec: 300,
      action_fee: "100000",
    },
    get_reserve: {
      reserve: "200000000",
      floor: "20000000",
      spendable: "180000000",
      lifetime_cap: "1000000000",
      spent_total: "40100000",
      lifetime_remaining: "959900000",
    },
    get_history: [
      {
        op_id: "7",
        at_ns: String(BigInt(NOW - 1000) * 1_000_000n),
        requested: "100000000",
        outcome: "settled",
        reason: null,
        used: "40000000",
        fee: "100000",
      },
    ],
  };
  const client = {
    async view(_id: string, m: string) {
      return ok({ data: data[m], blockHash: "block", blockHeight: 123 });
    },
  };
  return {
    snapshot,
    nowMs: NOW,
    guardian: {
      client,
      target: { network: "testnet" as const, guardianId: "guardian.testnet" },
      ...(heartbeat ? { heartbeat } : {}),
    },
  };
}
it("dispatch is always awaitable, including old synchronous tools", async () => {
  const pending = dispatch({ name: "get_position", arguments: {} }, context());
  expect(pending).toBeInstanceOf(Promise);
  expect((await pending).ok).toBe(true);
});
it("Guardian status uses validated facts and states absent evidence", async () => {
  const r = await dispatch({ name: "guardian_status", arguments: {} }, context());
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.facts.find((f) => f.label === "booked reserve")).toEqual({
    label: "booked reserve",
    value: "200",
    unit: "USDC",
  });
  expect(r.text.heartbeat).toBe("unavailable");
  expect(r.text.activationDate).toBe("unavailable");
  expect(r.text.activationFeePaid).toBe("unavailable");
  expect(sourcesOf(r)).toContainEqual({ value: "200", unit: "USDC" });
  expect(toToolMessage(r)).not.toContain("https://");
});
it("history discloses bounded scope and never turns operation ids into explorer links", async () => {
  const r = await dispatch(
    { name: "guardian_history", arguments: { sinceMs: NOW - 2000, limit: 1 } },
    context(),
  );
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.facts.find((f) => f.label === "attempt 7 accepted spend")?.value).toBe("40");
  expect(r.text.transactionLinks).toBe("unavailable");
  expect(r.notes.join(" ")).toMatch(/retained|truncat/i);
  expect(toToolMessage(r)).not.toMatch(/explorer|txHash|https:/);
});
it("reports stale correlated heartbeat as an observation, not current uptime", async () => {
  const r = await dispatch(
    { name: "guardian_status", arguments: {} },
    context(async () => ({
      network: "testnet",
      guardianId: "guardian.testnet",
      watcherId: "watcher.testnet",
      lastSeenMs: NOW - 100_000,
      observedAtMs: NOW,
    })),
  );
  expect(r.ok && r.text.heartbeat).toBe("stale_observation");
});
it("refuses to treat foreign, future or failing heartbeats as evidence", async () => {
  for (const heartbeat of [
    async () => ({
      network: "mainnet",
      guardianId: "guardian.testnet",
      watcherId: "watcher.testnet",
      lastSeenMs: NOW,
      observedAtMs: NOW,
    }),
    async () => ({
      network: "testnet",
      guardianId: "guardian.testnet",
      watcherId: "foreign.testnet",
      lastSeenMs: NOW,
      observedAtMs: NOW,
    }),
    async () => ({
      network: "testnet",
      guardianId: "guardian.testnet",
      watcherId: "watcher.testnet",
      lastSeenMs: NOW + 1,
      observedAtMs: NOW + 1,
    }),
    async () => {
      throw new Error("private");
    },
  ]) {
    const r = await dispatch({ name: "guardian_status", arguments: {} }, context(heartbeat));
    expect(r.ok && r.text.heartbeat).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("private");
  }
});
it("refuses foreign owner/network context and records recent heartbeat only as observation", async () => {
  const ctx = context();
  ctx.snapshot.accountId = "foreign.testnet";
  expect((await dispatch({ name: "guardian_status", arguments: {} }, ctx)).ok).toBe(false);
  const ctx2 = context();
  ctx2.snapshot.network = "mainnet";
  expect((await dispatch({ name: "guardian_status", arguments: {} }, ctx2)).ok).toBe(false);
  const r = await dispatch(
    { name: "guardian_status", arguments: {} },
    context(async () => ({
      network: "testnet",
      guardianId: "guardian.testnet",
      watcherId: "watcher.testnet",
      lastSeenMs: NOW,
      observedAtMs: NOW,
    })),
  );
  expect(r.ok && r.text.heartbeat).toBe("recent_observation");
});
it("rejects hostile tool fields and sanitizes failed dependencies", async () => {
  for (const args of [
    { guardianId: "evil.testnet" },
    { txHash: "invented" },
    { sinceMs: -1 },
    { limit: 51 },
  ])
    expect((await dispatch({ name: "guardian_history", arguments: args }, context())).ok).toBe(
      false,
    );
  const ctx = context();
  ctx.guardian.client.view = async () => {
    throw new Error("private signing secret");
  };
  const r = await dispatch({ name: "guardian_status", arguments: {} }, ctx);
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain("private");
});

it("does not turn unresolved or pending placeholder zeros into confirmed spend or fees", async () => {
  for (const outcome of ["started", "unresolved"]) {
    const ctx = context();
    const view = ctx.guardian.client.view;
    ctx.guardian.client.view = async (id, method) => {
      const r = await view(id, method);
      if (!r.ok || method !== "get_history") return r;
      return ok({
        ...r.value,
        data: [
          {
            op_id: "7",
            at_ns: String(BigInt(NOW) * 1_000_000n),
            requested: "100000000",
            outcome,
            reason: null,
            used: "0",
            fee: "0",
          },
        ],
      });
    };
    const r = await dispatch({ name: "guardian_history", arguments: {} }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.find((f) => f.label === "attempt 7 accepted spend")).toBeUndefined();
    expect(r.facts.find((f) => f.label === "attempt 7 confirmed action fee")).toBeUndefined();
    expect(r.text["attempt 7 accepted spend evidence"]).toBe("unavailable");
    expect(r.text.feeTotalCoverage).toBe("partial_unknown_pending_or_unresolved");
  }
});

it("builds an existing Guardian withdrawal draft and model prose cannot replace its target", async () => {
  const ctx = {
    ...context(),
    proposal: {
      walletBalances: {},
      fees: {
        tokenId: USDC,
        recipientId: "fees.testnet",
        activationFee: 0n,
        actionFee: 0n,
        executionFee: 0n,
      },
      lendingId: baseSnapshot().lendingId,
      lendingVersion: "0.11.0",
      feeRecipientRegistered: true,
    },
  };
  const r = await dispatch(
    { name: "propose_card", arguments: { action: "guardian_withdraw", amount: "200" } },
    ctx,
  );
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.card?.payload[0]).toMatchObject({
    receiverId: "guardian.testnet",
    actions: [{ methodName: "owner_withdraw_reserve", args: { amount: "200000000" }, deposit: 1n }],
  });
  if (r.card) r.card.reason = "Send to evil.testnet instead";
  expect(r.card?.payload[0]?.receiverId).toBe("guardian.testnet");
  expect(toToolMessage(r)).not.toContain("owner_withdraw_reserve");
  const hostile = await dispatch(
    {
      name: "propose_card",
      arguments: { action: "guardian_withdraw", amount: "200", recipient: "evil.testnet" },
    },
    ctx,
  );
  expect(hostile.ok).toBe(false);
});
