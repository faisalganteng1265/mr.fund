import { expect, it } from "vitest";
import { readGuardian } from "../src/read";
import { guardianOwnerPayload } from "../src/tx/owner";
import { fakeClient, NOW, target, views } from "./fixture";

it("binds owner controls to the validated Guardian and actual 1-yocto ABI", async () => {
  const r = await readGuardian(fakeClient(), target, { now: () => NOW });
  if (!r.ok) throw new Error("fixture");
  for (const [request, method, args] of [
    [{ kind: "pause" }, "pause", {}],
    [
      { kind: "rotate_watcher", watcherId: "next.testnet" },
      "rotate_watcher",
      { watcher_id: "next.testnet" },
    ],
  ] as const) {
    const p = guardianOwnerPayload(r.value, request, { ownerId: "alice.testnet", nowMs: NOW });
    expect(p.ok).toBe(true);
    if (p.ok)
      expect(p.value[0]).toMatchObject({
        receiverId: target.guardianId,
        actions: [{ methodName: method, args, deposit: 1n }],
      });
  }
});
it("withdraws reserve after deactivation and rejects stale/foreign/locked or overdrawn inputs", async () => {
  const data = views();
  data.get_status.status = "deactivated";
  const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
  if (!r.ok) throw new Error("fixture");
  expect(
    guardianOwnerPayload(
      r.value,
      { kind: "withdraw_reserve", amount: 200n },
      { ownerId: "alice.testnet", nowMs: NOW },
    ).ok,
  ).toBe(true);
  for (const context of [
    { ownerId: "foreign.testnet", nowMs: NOW },
    { ownerId: "alice.testnet", nowMs: NOW + 120001 },
  ])
    expect(
      guardianOwnerPayload(r.value, { kind: "withdraw_reserve", amount: 1n }, context).ok,
    ).toBe(false);
  expect(
    guardianOwnerPayload(
      r.value,
      { kind: "withdraw_reserve", amount: 201n },
      { ownerId: "alice.testnet", nowMs: NOW },
    ).ok,
  ).toBe(false);
});
it("routes activate through the activation builder, which refuses an active Guardian", async () => {
  const r = await readGuardian(fakeClient(), target, { now: () => NOW });
  if (!r.ok) throw new Error("fixture");
  const p = guardianOwnerPayload(
    r.value,
    { kind: "activate", amount: 100n },
    { ownerId: "alice.testnet", nowMs: NOW },
  );
  expect(p.ok).toBe(false);
  if (!p.ok)
    expect(p.error).toMatchObject({
      kind: "invalid_input",
      reason: expect.stringMatching(/already activated/),
    });
});

it("uses exact resume/deactivate/policy payloads and keeps policy bounds under lock", async () => {
  const data = views();
  data.get_status.status = "paused";
  const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
  if (!r.ok) throw new Error("fixture");
  const context = { ownerId: "alice.testnet", nowMs: NOW };
  for (const kind of ["resume", "deactivate"] as const) {
    const p = guardianOwnerPayload(r.value, { kind }, context);
    expect(p.ok && p.value[0]?.actions[0]?.methodName).toBe(kind);
  }
  const policy = { ...r.value.policy, maxPerAction: 80n };
  const p = guardianOwnerPayload(r.value, { kind: "set_policy", policy }, context);
  expect(p.ok).toBe(true);
  if (p.ok)
    expect(p.value[0]?.actions[0]).toMatchObject({
      methodName: "set_policy",
      deposit: 1n,
      args: {
        policy: {
          max_per_action: "80",
          lifetime_cap: "1000",
          reserve_floor: "20",
          trigger_hf_bps: 12000,
          target_hf_bps: 15000,
          cooldown_sec: 300,
          action_fee: "1",
        },
      },
    });
  expect(
    guardianOwnerPayload(
      r.value,
      { kind: "set_policy", policy: { ...policy, lifetimeCap: 1n } },
      context,
    ).ok,
  ).toBe(false);
  const locked = {
    ...r.value,
    status: {
      ...r.value.status,
      inFlight: {
        opId: 8n,
        amount: 100n,
        fee: 1n,
        startedNs: 0n,
        repayPhase: "unresolved" as const,
      },
    },
  };
  expect(guardianOwnerPayload(locked, { kind: "set_policy", policy }, context).ok).toBe(false);
  expect(guardianOwnerPayload(locked, { kind: "withdraw_reserve", amount: 1n }, context).ok).toBe(
    false,
  );
  expect(guardianOwnerPayload(locked, { kind: "deactivate" }, context).ok).toBe(true);
  const hostile = { kind: "withdraw_reserve", amount: 1n, recipient: "evil.testnet" } as const;
  expect(guardianOwnerPayload(r.value, hostile, context).ok).toBe(false);
});
