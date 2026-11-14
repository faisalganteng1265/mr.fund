import { dispatch } from "@mrfund/agent";
import { describe, expect, it } from "vitest";
import {
  NOW,
  baseSnapshot as sharedSnapshot,
  USDC,
  WNEAR,
} from "../../../packages/engine/test/helpers";
import { presentPosition } from "../src/position/presenter";

function baseSnapshot(overrides: Parameters<typeof sharedSnapshot>[0] = {}) {
  return structuredClone(sharedSnapshot(overrides));
}
const source = {
  protocol: "rhea" as const,
  lendingId: baseSnapshot().lendingId,
  lendingVersion: "0.11.0",
  blockHash: "anchor",
  blockHeight: baseSnapshot().blockHeight,
};
describe("exact public position presentation", () => {
  it("agrees with get_position at the same clock while retaining structured engine inputs", async () => {
    const snapshot = baseSnapshot();
    const view = presentPosition(snapshot, source, NOW);
    expect(view.health).toEqual({ kind: "value", bps: 14250 });
    expect(view.liquidationPrices).toEqual([
      {
        tokenId: WNEAR,
        kind: "price",
        multiplier: "35088",
        decimals: 28,
        usdPerWholeToken: "3.5088",
      },
    ]);
    expect(view.debt[0]?.atomic).toBe("200000000");
    const tool = await dispatch({ name: "get_position", arguments: {} }, { snapshot, nowMs: NOW });
    expect(tool.ok).toBe(true);
    if (tool.ok) {
      expect(tool.facts).toContainEqual({ label: "health factor", value: "1.425", unit: null });
      const liquidation = view.liquidationPrices[0];
      expect(liquidation?.kind).toBe("price");
      if (liquidation?.kind === "price")
        expect(tool.facts.some((f) => f.value === liquidation.usdPerWholeToken)).toBe(true);
      expect(view.assumptions).toEqual(expect.arrayContaining(tool.notes.slice(0, 2)));
    }
    expect(view.inputs.accountId).toBe("alice.testnet");
    expect(view.dataAgeMs).toBe(0);
  });
  it("preserves large internal units and conservatively rounds subatomic dust", () => {
    const s = baseSnapshot({
      supplied: [{ tokenId: USDC, internal: 18446744073709551617000000000001n }],
      borrowed: [{ tokenId: USDC, internal: 1000000000001n }],
      collateral: [{ tokenId: USDC, internal: 2000000000001n }],
    });
    const v = presentPosition(s, source, NOW);
    expect(v.supplied[0]).toMatchObject({
      internal: "18446744073709551617000000000001",
      atomic: "18446744073709551617",
      atomicRounding: "down",
    });
    expect(v.collateral[0]).toMatchObject({ atomic: "2", atomicRounding: "down" });
    expect(v.debt[0]).toMatchObject({ atomic: "2", atomicRounding: "up" });
    expect(v.assumptions).toContain(
      "When a token is both collateral and debt, liquidation price shocks only its collateral leg.",
    );
  });
  it("represents debt-free positions without infinity or invented liquidation prices", () => {
    const v = presentPosition(baseSnapshot({ borrowed: [] }), source, NOW);
    expect(v.health).toEqual({ kind: "no_debt" });
    expect(v.liquidationPrices).toEqual([{ tokenId: WNEAR, kind: "no_debt" }]);
  });
  it("distinguishes covered collateral from a zero market quote", () => {
    const s = baseSnapshot();
    s.collateral.push({ tokenId: USDC, internal: 1000n * 10n ** 18n });
    expect(presentPosition(s, source, NOW).liquidationPrices[0]).toEqual({
      tokenId: WNEAR,
      kind: "covered_by_other_collateral",
    });
  });
  it("preserves fixed price source, null time and assumptions", () => {
    const s = baseSnapshot();
    const price = s.prices[USDC];
    if (!price) throw new Error("Missing fixture price");
    s.prices[USDC] = { ...price, source: "default_price", publishTimeMs: null };
    const v = presentPosition(s, source, NOW);
    expect(v.debt[0]?.price).toMatchObject({ source: "default_price", publishTimeMs: null });
    expect(v.assumptions).toContain("USDC uses a fixed price");
  });
  it("allows unpriced supply but refuses unknown metadata rather than zero debt", () => {
    const s = baseSnapshot({ supplied: [{ tokenId: USDC, internal: 1n }], borrowed: [] });
    delete s.prices[USDC];
    expect(presentPosition(s, source, NOW).supplied[0]?.price).toBeNull();
    delete s.assets[USDC];
    expect(() => presentPosition(s, source, NOW)).toThrow("untrusted_data");
  });
  it("refuses empty positions and invalid source/clock/numeric fields", () => {
    expect(() =>
      presentPosition(baseSnapshot({ supplied: [], collateral: [], borrowed: [] }), source, NOW),
    ).toThrow("no_position");
    expect(() => presentPosition(baseSnapshot(), { ...source, blockHeight: 1 }, NOW)).toThrow(
      "untrusted_data",
    );
    expect(() => presentPosition(baseSnapshot(), source, 0.5)).toThrow("untrusted_data");
    expect(() => presentPosition(baseSnapshot(), source, NOW, 0)).toThrow("untrusted_data");
    const s = baseSnapshot();
    const asset = s.assets[USDC];
    if (!asset) throw new Error("Missing fixture metadata");
    asset.borrowAprBps = 0.5;
    expect(() => presentPosition(s, source, NOW)).toThrow("untrusted_data");
  });
  it("uses one freshness limit for snapshot and prices, including exact boundaries", () => {
    const s = baseSnapshot();
    expect(presentPosition(s, source, NOW + 120000).dataAgeMs).toBe(120000);
    expect(() => presentPosition(s, source, NOW + 120001)).toThrow("stale_data");
    expect(presentPosition(s, source, NOW + 120001, 120001).maxDataAgeMs).toBe(120001);
    s.readAtMs = NOW + 120001;
    expect(() => presentPosition(s, source, NOW + 120001)).toThrow("stale_data");
  });
  it("retains capped health assumptions and refuses unsupported debt metadata", () => {
    const s = baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 1n }] });
    const view = presentPosition(s, source, NOW);
    expect(view.health).toEqual({ kind: "value", bps: Number.MAX_SAFE_INTEGER });
    expect(view.assumptions).toContain(`Health above ${Number.MAX_SAFE_INTEGER} bps is capped.`);
    delete s.assets[USDC];
    expect(() => presentPosition(s, source, NOW)).toThrow("untrusted_data");
  });
  it("rejects a future-dated non-collateral price even though health does not use it", () => {
    const s = baseSnapshot({ borrowed: [], supplied: [{ tokenId: USDC, internal: 1n }] });
    const price = s.prices[USDC];
    if (!price) throw new Error("Missing fixture price");
    price.publishTimeMs = NOW + 60001;
    expect(() => presentPosition(s, source, NOW)).toThrow("untrusted_data");
  });
});
