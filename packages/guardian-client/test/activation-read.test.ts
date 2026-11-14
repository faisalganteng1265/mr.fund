import { ok } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { readActivationState, readFactory } from "../src/activation-read";
import { NOW, views } from "./fixture";

const FACTORY = "factory.testnet";
const GUARDIAN = "guardian.testnet";

type Contracts = Record<string, Record<string, unknown>>;
function world(over: { factory?: Record<string, unknown>; status?: string } = {}) {
  const guardian: Record<string, unknown> = views();
  (guardian.get_status as Record<string, unknown>).status = over.status ?? "created";
  const contracts: Contracts = {
    [FACTORY]: {
      get_guardian: GUARDIAN,
      is_pending: false,
      get_unclaimed: "0",
      get_next_guardian_id: "g1.factory.testnet",
      get_template: {
        debt_token_id: "usdc.testnet",
        collateral_token_id: "wrap.testnet",
        lending_id: "rhea.testnet",
        fee_recipient_id: "fees.testnet",
        activation_fee: "5",
      },
      get_limits: {
        min_funding: "2753250000000000000000000",
        max_funding: "10000000000000000000000000",
      },
      ...over.factory,
    },
    [GUARDIAN]: guardian,
    "rhea.testnet": { storage_balance_of: null },
    "usdc.testnet": { storage_balance_of: null },
    "wrap.testnet": { storage_balance_of: null },
  };
  const calls: string[] = [];
  return {
    contracts,
    calls,
    client: {
      async view(id: string, method: string) {
        calls.push(`${id}.${method}`);
        return ok({ data: contracts[id]?.[method] ?? null, blockHeight: 123, blockHash: "block" });
      },
    },
  };
}
const read = (w: ReturnType<typeof world>) =>
  readActivationState(w.client, { network: "testnet", factoryId: FACTORY }, "alice.testnet", {
    now: () => NOW,
  });

describe("readActivationState", () => {
  it("reports none with the id the next creation will use", async () => {
    const w = world({ factory: { get_guardian: null } });
    expect(await read(w)).toEqual({
      ok: true,
      value: { kind: "none", nextGuardianId: "g1.factory.testnet", unclaimed: 0n },
    });
  });

  it("reports a creation in flight without showing a Guardian", async () => {
    const w = world({ factory: { get_guardian: null, is_pending: true } });
    expect(await read(w)).toMatchObject({ ok: true, value: { kind: "pending" } });
    expect(w.calls.some((c) => c.startsWith(GUARDIAN))).toBe(false);
  });

  it("reports a failed creation with a claimable refund", async () => {
    const w = world({
      factory: { get_guardian: null, get_unclaimed: "2753250000000000000000000" },
    });
    expect(await read(w)).toEqual({
      ok: true,
      value: { kind: "failed", unclaimed: 2_753_250_000_000_000_000_000_000n },
    });
  });

  it("resumes registration at the first unregistered target, in order", async () => {
    const w = world();
    let r = await read(w);
    expect(r).toMatchObject({ ok: true, value: { kind: "created", next: "lending" } });
    w.contracts["rhea.testnet"] = { storage_balance_of: { total: "1", available: "0" } };
    r = await read(w);
    expect(r).toMatchObject({
      ok: true,
      value: {
        kind: "created",
        next: "debt_token",
        registered: { lending: true, debt_token: false, collateral_token: false },
      },
    });
    w.contracts["usdc.testnet"] = { storage_balance_of: { total: "1", available: "0" } };
    w.contracts["wrap.testnet"] = { storage_balance_of: { total: "1", available: "0" } };
    expect(await read(w)).toMatchObject({ ok: true, value: { kind: "registered" } });
  });

  it("reports activated for active, paused and deactivated Guardians", async () => {
    for (const status of ["active", "paused", "deactivated"]) {
      const r = await read(world({ status }));
      expect(r).toMatchObject({ ok: true, value: { kind: "activated" } });
      if (r.ok && r.value.kind === "activated") expect(r.value.guardian.status.status).toBe(status);
    }
  });

  it("refuses malformed views and a Guardian owned by someone else", async () => {
    expect((await read(world({ factory: { is_pending: "no" } }))).ok).toBe(false);
    expect((await read(world({ factory: { get_unclaimed: -1 } }))).ok).toBe(false);
    const foreign = world();
    (foreign.contracts[GUARDIAN] as ReturnType<typeof views>).get_config.owner_id = "bob.testnet";
    (foreign.contracts[GUARDIAN] as ReturnType<typeof views>).get_status.owner_id = "bob.testnet";
    expect(await read(foreign)).toMatchObject({ ok: false, error: { kind: "bad_response" } });
    const broken = world();
    broken.contracts["rhea.testnet"] = { storage_balance_of: [1] };
    expect((await read(broken)).ok).toBe(false);
  });
});

describe("readFactory", () => {
  it("reads the fee, recipient and funding bounds from chain", async () => {
    expect(await readFactory(world().client, FACTORY)).toEqual({
      ok: true,
      value: {
        factoryId: FACTORY,
        minFunding: 2_753_250_000_000_000_000_000_000n,
        maxFunding: 10_000_000_000_000_000_000_000_000n,
        debtTokenId: "usdc.testnet",
        collateralTokenId: "wrap.testnet",
        lendingId: "rhea.testnet",
        feeRecipientId: "fees.testnet",
        activationFee: 5n,
      },
    });
  });

  it("refuses inverted bounds", async () => {
    const w = world({ factory: { get_limits: { min_funding: "2", max_funding: "1" } } });
    expect((await readFactory(w.client, FACTORY)).ok).toBe(false);
  });
});
