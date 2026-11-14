import { describe, expect, it } from "vitest";
import { whatIfPrice } from "../src/whatif";
import { baseSnapshot, NOW, USDC, WNEAR, wnearPrice } from "./helpers";

function run(shocks: { tokenId: string; changeBps: number }[], s = baseSnapshot()) {
  const r = whatIfPrice(s, shocks, NOW);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("whatIfPrice", () => {
  it("collateral -20% matches the hand calculation", () => {
    // C = 100 * $4 * 0.6 = $240 ; B = $210.526... ; 240 / 210.526... = 1.14
    const r = run([{ tokenId: WNEAR, changeBps: -2000 }]);
    expect(r.value).toEqual({ healthBps: 11_400, liquidatable: false });
  });

  it("collateral -30% is liquidatable (strictly below 100%)", () => {
    // C = $210 ; 210 / 210.526... = 0.9975
    expect(run([{ tokenId: WNEAR, changeBps: -3000 }]).value).toEqual({
      healthBps: 9975,
      liquidatable: true,
    });
  });

  it("a debt price increase lowers health exactly", () => {
    expect(run([{ tokenId: USDC, changeBps: 2500 }]).value.healthBps).toBe(11_400);
  });

  it("combines shocks on several tokens", () => {
    expect(
      run([
        { tokenId: WNEAR, changeBps: -2000 },
        { tokenId: USDC, changeBps: 2500 },
      ]).value.healthBps,
    ).toBe(9120);
  });

  it("is labelled a scenario and lists the shocks", () => {
    const r = run([{ tokenId: WNEAR, changeBps: -2000 }]);
    expect(r.assumptions.join(" ")).toContain("Scenario");
    expect(r.inputs[`shock:${WNEAR}`]).toBe("-2000");
  });

  it("accepts the bounds and rejects beyond them", () => {
    expect(whatIfPrice(baseSnapshot(), [{ tokenId: WNEAR, changeBps: -9500 }], NOW).ok).toBe(true);
    expect(whatIfPrice(baseSnapshot(), [{ tokenId: WNEAR, changeBps: 50_000 }], NOW).ok).toBe(true);
    for (const changeBps of [-9501, 50_001, -9900, 1.5, Number.NaN]) {
      const r = whatIfPrice(baseSnapshot(), [{ tokenId: WNEAR, changeBps }], NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("invalid_amount");
    }
  });

  it("rejects two shocks on the same token", () => {
    const r = whatIfPrice(
      baseSnapshot(),
      [
        { tokenId: WNEAR, changeBps: -100 },
        { tokenId: WNEAR, changeBps: -200 },
      ],
      NOW,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown token", () => {
    expect(
      whatIfPrice(baseSnapshot(), [{ tokenId: "mystery.testnet", changeBps: -1000 }], NOW),
    ).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: "mystery.testnet" },
    });
  });

  it("never mutates the snapshot", () => {
    const s = baseSnapshot();
    run([{ tokenId: WNEAR, changeBps: -2000 }], s);
    expect(s.prices[WNEAR]).toEqual(wnearPrice);
  });

  it("is not liquidatable when there is no debt", () => {
    const r = run([{ tokenId: WNEAR, changeBps: -9500 }], baseSnapshot({ borrowed: [] }));
    expect(r.value).toEqual({ healthBps: "no_debt", liquidatable: false });
  });

  it("refuses to advise on stale prices", () => {
    const s = baseSnapshot();
    s.prices[WNEAR] = { ...wnearPrice, publishTimeMs: NOW - 120_001 };
    expect(whatIfPrice(s, [{ tokenId: WNEAR, changeBps: -2000 }], NOW).ok).toBe(false);
  });
});
