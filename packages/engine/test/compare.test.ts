import { describe, expect, it } from "vitest";
import { repayVsYield } from "../src/compare";
import { baseSnapshot, NOW, USDC, usdcAsset } from "./helpers";

const params = { amount: 100_000_000n, tokenId: USDC, yieldAprBps: 1401, horizonDays: 365 };

function run(p = params, s = baseSnapshot()) {
  const r = repayVsYield(s, p, NOW);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("repayVsYield", () => {
  it("reproduces the PRD example exactly (100 USDC, 21.00% vs 14.01%, 365 days)", () => {
    const r = run();
    expect(r.value.repaySaves).toBe(21_000_000n);
    expect(r.value.yieldEarns).toBe(14_010_000n);
    expect(r.value.winner).toBe("repay");
    expect(r.value.amountUsed).toBe(100_000_000n);
  });

  it("carries inputs and assumptions", () => {
    const r = run();
    expect(r.inputs.borrowAprBps).toBe("2100");
    expect(r.inputs.yieldAprBps).toBe("1401");
    expect(r.inputs.horizonDays).toBe("365");
    expect(r.assumptions.join(" ")).toContain("APR");
    expect(r.assumptions.join(" ")).toContain("Rates change");
  });

  it("is equal when the rates are equal", () => {
    const s = baseSnapshot();
    s.assets[USDC] = { ...usdcAsset, borrowAprBps: 1401 };
    expect(run(params, s).value.winner).toBe("equal");
  });

  it("picks yield when it pays more than the loan costs", () => {
    expect(run({ ...params, yieldAprBps: 3000 }).value.winner).toBe("yield");
  });

  it("decides the winner on the rates, not on rounded amounts", () => {
    // 1 atomic unit over 1 day rounds both sides to 0, yet the rates differ.
    const r = run({ ...params, amount: 1n, horizonDays: 1 });
    expect(r.value.repaySaves).toBe(0n);
    expect(r.value.yieldEarns).toBe(0n);
    expect(r.value.winner).toBe("repay");
  });

  it("prorates a shorter horizon linearly and floors", () => {
    // 100e6 * 2100 * 180 / (10000 * 365) = 10_356_164.38...
    expect(run({ ...params, horizonDays: 180 }).value.repaySaves).toBe(10_356_164n);
  });

  it("caps the amount at the outstanding debt and says so", () => {
    const r = run({ ...params, amount: 500_000_000n });
    expect(r.value.amountUsed).toBe(200_000_000n);
    expect(r.value.repaySaves).toBe(42_000_000n);
    expect(r.assumptions.join(" ")).toContain("capped at the outstanding debt");
  });

  it("keeps amounts beyond 2^64 exact", () => {
    const big = 10n ** 30n;
    const s = baseSnapshot({ borrowed: [{ tokenId: USDC, internal: big * 10n ** 12n }] });
    expect(run({ ...params, amount: big }, s).value.repaySaves).toBe((big * 2100n) / 10_000n);
  });

  it.each([
    ["zero amount", { amount: 0n }],
    ["zero horizon", { horizonDays: 0 }],
    ["fractional horizon", { horizonDays: 1.5 }],
    ["horizon above ten years", { horizonDays: 3651 }],
    ["negative yield rate", { yieldAprBps: -1 }],
    ["fractional yield rate", { yieldAprBps: 1.5 }],
  ])("rejects %s with invalid_amount", (_name, patch) => {
    const r = repayVsYield(baseSnapshot(), { ...params, ...patch }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_amount");
  });

  it("rejects a token with no outstanding debt", () => {
    const r = repayVsYield(baseSnapshot({ borrowed: [] }), params, NOW);
    expect(r).toEqual({
      ok: false,
      error: { kind: "invalid_amount", reason: "no outstanding debt in this token" },
    });
  });

  it("rejects an unknown token", () => {
    const r = repayVsYield(baseSnapshot(), { ...params, tokenId: "mystery.testnet" }, NOW);
    expect(r).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: "mystery.testnet" },
    });
  });
});
