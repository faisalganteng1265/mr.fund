import { expect, it } from "vitest";
import { recorded } from "./outcome-fixtures";

it.each(["testnet", "mainnet"])(
  "validates %s recording provenance and independently recorded debt/surplus",
  (network) => {
    for (const name of [
      "repay-success",
      "repay-surplus",
      "full-refund",
      "partial-refund-fixture-receiver",
      "detached-failure",
      "fee-failure",
    ]) {
      const p = recorded(network, name).recording._provenance;
      expect(p.kind).toBe("sandbox");
      expect(p.prices).toBe("Simulated");
      expect(p.sourceWasm.network).toBe(network);
      expect(p.sourceWasm.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(p.receiverFixtureWasmSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(BigInt(p.recordedAtUnixMs)).toBeGreaterThan(0n);
      expect(p.sourceWasm.version).toBe(network === "testnet" ? "0.11.0" : "0.16.2");
    }
    const success = recorded(network, "repay-success"),
      surplus = recorded(network, "repay-surplus");
    const sum = (rows: { token_id: string; balance: string }[], id: string) =>
      rows.filter((r) => r.token_id === id).reduce((total, r) => total + BigInt(r.balance), 0n);
    const before = success.recording.observations.before,
      after = success.recording.observations.after;
    expect(
      sum(before.borrowed, success.plan.tokenId) - sum(after.borrowed, success.plan.tokenId),
    ).toBe(10n ** 18n);
    expect(sum(surplus.recording.observations.before.borrowed, surplus.plan.tokenId)).toBe(
      9_000_000_000_000_000_001n,
    );
    expect(surplus.recording.observations.after.borrowed).toEqual([]);
    expect(
      sum(surplus.recording.observations.after.supplied, surplus.plan.tokenId) -
        sum(surplus.recording.observations.before.supplied, surplus.plan.tokenId),
    ).toBe(999_999_999_999n);
  },
);
