import { describe, expect, it } from "vitest";
import { readGuardian, toGuardianState } from "../src/read";
import { fakeClient, NOW, target, views } from "./fixture";

const first = (data: ReturnType<typeof views>) => {
  const a = data.get_history[0];
  if (!a) throw new Error("Missing fixture attempt");
  return a;
};

describe("validated Guardian reads", () => {
  it("pins every dependent read and maps exact units to engine state", async () => {
    const client = fakeClient();
    const r = await readGuardian(client, target, { now: () => NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reserve.reserve).toBe(200n);
    expect(r.value.policy.maxPerAction).toBe(100n);
    expect(r.value.config.activationFee).toBe(5n);
    expect(r.value.history.attempts[0]?.atNs).toBe(BigInt(NOW - 1000) * 1_000_000n);
    expect(r.value.history.transactionLinks).toBe("unavailable");
    expect(client.calls[0]).toMatchObject({ method: "get_config", blockId: undefined });
    expect(client.calls.slice(1).every((c) => c.blockId === "block")).toBe(true);
    expect(toGuardianState(r.value)).toMatchObject({
      status: "active",
      reserve: 200n,
      spentTotal: 41n,
      lastActionStartedNs: 0n,
    });
  });
  it.each(["-1", "01", "340282366920938463463374607431768211456", 1])(
    "refuses malformed reserve %j",
    async (amount) => {
      const data = views();
      data.get_reserve.reserve = amount as string;
      const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
      expect(r.ok ? null : r.error.kind).toBe("bad_response");
    },
  );
  it("filters the bounded ring in backend and preserves truncation", async () => {
    const data = views();
    data.get_history = Array.from({ length: 50 }, (_, i) => ({
      ...first(data),
      op_id: String(i),
      at_ns: String(BigInt(NOW - 50 + i) * 1_000_000n),
    }));
    const client = fakeClient(data);
    const r = await readGuardian(client, target, { now: () => NOW, sinceMs: NOW - 10, limit: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.history.attempts.map((a) => a.opId)).toEqual([47n, 48n, 49n]);
    expect(r.value.history).toMatchObject({
      retainedCount: 50,
      retention: "possibly_truncated",
      limited: true,
      transactionLinks: "unavailable",
    });
    expect(client.calls.find((c) => c.method === "get_history")?.args).toEqual({
      from: 0,
      limit: 50,
    });
  });
  it("does not infer all-time completeness from a short ring", async () => {
    const data = views();
    first(data).op_id = "99";
    const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
    expect(r.ok && r.value.history.retention).toBe("possibly_truncated");
  });
  it("rejects mixed blocks and sanitized thrown transports", async () => {
    const client = fakeClient();
    const mixed = {
      async view(id: string, m: string, a: unknown, b?: string) {
        const r = await client.view(id, m, a, b);
        if (!r.ok) return r;
        return { ...r, value: { ...r.value, blockHash: b ? "other" : "block" } };
      },
    };
    expect((await readGuardian(mixed, target, { now: () => NOW })).ok).toBe(false);
    const r = await readGuardian(
      {
        view: async () => {
          throw new Error("secret key material");
        },
      },
      target,
      { now: () => NOW },
    );
    expect(r.ok ? null : r.error.kind).toBe("rpc_unavailable");
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("refuses invalid filters before network I/O", async () => {
    for (const options of [{ limit: 51 }, { limit: 0 }, { sinceMs: -1 }, { sinceMs: NOW + 1 }]) {
      const c = fakeClient();
      expect((await readGuardian(c, target, { now: () => NOW, ...options })).ok).toBe(false);
      expect(c.calls).toHaveLength(0);
    }
  });
  it.each([
    ["get_status", "status", "unknown"],
    ["get_status", "last_action_started_ns", "18446744073709551616"],
    ["get_status", "last_action_started_ns", String(BigInt(NOW + 1) * 1_000_000n)],
    ["get_config", "lending_version", "unknown"],
    ["get_config", "debt_extra_decimals", 39],
    ["get_config", "collateral_price_id", "bad"],
    ["get_policy", "cooldown_sec", 299],
    ["get_policy", "target_hf_bps", 12000],
    ["get_reserve", "spendable", "999"],
    ["get_reserve", "lifetime_remaining", "999"],
    ["get_status", "owner_id", "other.testnet"],
  ])("rejects malformed or inconsistent %s.%s", async (method, key, value) => {
    const data: Record<string, unknown> = views();
    (data[method] as Record<string, unknown>)[key] = value;
    expect((await readGuardian(fakeClient(data), target, { now: () => NOW })).ok).toBe(false);
  });
  it("recognizes every pending phase without losing the shared lock", async () => {
    for (const phase of [null, "reading", "repaying", "unresolved", { fee: { used: "40" } }]) {
      const data: Record<string, unknown> = views();
      (data.get_status as Record<string, unknown>).in_flight = {
        op_id: "0",
        amount: "100",
        fee: "1",
        started_ns: "0",
        repay_phase: phase,
      };
      const r = await readGuardian(fakeClient(data), target, { now: () => NOW });
      expect(r.ok).toBe(true);
      if (r.ok) expect(toGuardianState(r.value).inFlight?.amount).toBe(100n);
    }
  });
  it("reads a position lock (owner_register/owner_sweep) that holds amount 0", async () => {
    // The contract's lock_position(0, Register) reports amount 0 with no repay phase.
    const read = async (amount: string, phase: unknown) => {
      const data: Record<string, unknown> = views();
      (data.get_status as Record<string, unknown>).in_flight = {
        op_id: "3",
        amount,
        fee: "0",
        started_ns: "0",
        repay_phase: phase,
      };
      return readGuardian(fakeClient(data), target, { now: () => NOW });
    };
    const r = await read("0", null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status.inFlight).toMatchObject({ opId: 3n, amount: 0n });
    // A repayment phase with nothing locked is still corrupt.
    expect((await read("0", "repaying")).ok).toBe(false);
  });
  it("refuses corrupt history rather than inventing an interpretation", async () => {
    for (const mutate of [
      (a: Record<string, unknown>) => {
        a.outcome = "unknown";
      },
      (a: Record<string, unknown>) => {
        a.used = "101";
      },
      (a: Record<string, unknown>) => {
        a.reason = "not_active";
      },
      (a: Record<string, unknown>) => {
        a.at_ns = "18446744073709551616";
      },
    ]) {
      const data = views();
      mutate(first(data));
      expect((await readGuardian(fakeClient(data), target, { now: () => NOW })).ok).toBe(false);
    }
    const data = views();
    data.get_history.push({ ...first(data) });
    expect((await readGuardian(fakeClient(data), target, { now: () => NOW })).ok).toBe(false);
  });
  it("preserves typed not-found and unavailable kinds but discards raw dependency details", async () => {
    for (const kind of ["not_found", "rpc_unavailable", "bad_response"] as const) {
      const r = await readGuardian(
        { view: async () => ({ ok: false, error: { kind, detail: "private secret" } }) },
        target,
        { now: () => NOW },
      );
      expect(r.ok ? null : r.error.kind).toBe(kind);
      expect(JSON.stringify(r)).not.toContain("secret");
    }
  });
});
