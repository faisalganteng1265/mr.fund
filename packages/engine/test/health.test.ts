import { describe, expect, it } from "vitest";
import { healthBps, liquidationDiscountBps, liquidationPrice } from "../src/health";
import { baseSnapshot, NOW, USDC, usdcAsset, usdcPrice, WNEAR, wnearPrice } from "./helpers";

function health(s = baseSnapshot(), now = NOW) {
  const r = healthBps(s, now);
  if (!r.ok) throw new Error(`unexpected error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("liquidationDiscountBps", () => {
  it("is 6.25% at 87.5% health", () => {
    expect(liquidationDiscountBps(8750)).toBe(625);
  });
  it("is 0 at or above 100% health", () => {
    expect(liquidationDiscountBps(10_000)).toBe(0);
    expect(liquidationDiscountBps(15_000)).toBe(0);
  });
  it("rounds up (the larger discount is the conservative one)", () => {
    expect(liquidationDiscountBps(9999)).toBe(1);
  });
  it("rejects invalid input", () => {
    expect(() => liquidationDiscountBps(-1)).toThrow(RangeError);
    expect(() => liquidationDiscountBps(1.5)).toThrow(RangeError);
  });
});

describe("healthBps", () => {
  it("matches the hand-computed vector", () => {
    // C = 100 wNEAR * $5 * 0.60 = $300 ; B = 200 USDC * $1 / 0.95 = $210.526...
    // health = 300 / 210.526... = 1.425 exactly = 14250 bps
    const r = health();
    expect(r.value).toBe(14_250);
    expect(r.dataAgeMs).toBe(0);
    expect(r.inputs.accountId).toBe("alice.testnet");
    expect(r.inputs.blockHeight).toBe("276211785");
  });

  it("floors instead of rounding to nearest", () => {
    // 100 wNEAR + 1 atomic more debt keeps the true ratio just under 14250.
    const s = baseSnapshot({
      borrowed: [{ tokenId: USDC, internal: (200n * 10n ** 6n + 1n) * 10n ** 12n }],
    });
    expect(health(s).value).toBe(14_249);
  });

  it("caps an enormous health at MAX_SAFE_INTEGER and says so", () => {
    const s = baseSnapshot({ collateral: [{ tokenId: WNEAR, internal: 10n ** 40n }] });
    const r = health(s);
    expect(r.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(r.assumptions).toContain("Health above 9007199254740991 bps is capped.");
  });

  it("is no_debt when nothing is borrowed", () => {
    expect(health(baseSnapshot({ borrowed: [] })).value).toBe("no_debt");
  });

  it("is no_debt when every borrowed balance is zero", () => {
    expect(health(baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 0n }] })).value).toBe(
      "no_debt",
    );
  });

  it("is 0 with debt and no collateral", () => {
    expect(health(baseSnapshot({ collateral: [] })).value).toBe(0);
  });

  it("excludes supplied balances that are not collateral", () => {
    const s = baseSnapshot({ supplied: [{ tokenId: WNEAR, internal: 10n ** 30n }] });
    expect(health(s).value).toBe(14_250);
    expect(health(s).assumptions.join(" ")).toContain("not used as collateral");
  });

  it("returns missing_price when a needed price is absent", () => {
    const s = baseSnapshot();
    delete s.prices[WNEAR];
    expect(healthBps(s, NOW)).toEqual({
      ok: false,
      error: { kind: "missing_price", tokenId: WNEAR },
    });
  });

  it("treats a zero multiplier as missing_price (a zero debt price would hide the debt)", () => {
    const s = baseSnapshot({
      prices: { [WNEAR]: wnearPrice, [USDC]: { ...usdcPrice, multiplier: 0n } },
    });
    expect(healthBps(s, NOW)).toEqual({
      ok: false,
      error: { kind: "missing_price", tokenId: USDC },
    });
  });

  it("returns stale_price 1 ms past the limit and accepts the limit itself", () => {
    const at = (age: number) =>
      baseSnapshot({
        prices: { [WNEAR]: { ...wnearPrice, publishTimeMs: NOW - age }, [USDC]: usdcPrice },
      });
    expect(healthBps(at(120_000), NOW).ok).toBe(true);
    expect(healthBps(at(120_001), NOW)).toEqual({
      ok: false,
      error: { kind: "stale_price", tokenId: WNEAR, ageMs: 120_001, limitMs: 120_000 },
    });
  });

  it("honours a custom limit", () => {
    const s = baseSnapshot({
      prices: { [WNEAR]: { ...wnearPrice, publishTimeMs: NOW - 5_001 }, [USDC]: usdcPrice },
    });
    expect(healthBps(s, NOW, { maxDataAgeMs: 5_000 }).ok).toBe(false);
  });

  it("reports the oldest input as data age", () => {
    const s = baseSnapshot({
      readAtMs: NOW - 30_000,
      prices: { [WNEAR]: { ...wnearPrice, publishTimeMs: NOW - 90_000 }, [USDC]: usdcPrice },
    });
    expect(health(s).dataAgeMs).toBe(90_000);
  });

  it("returns unsupported_asset for a token with no asset config", () => {
    const s = baseSnapshot({ borrowed: [{ tokenId: "mystery.testnet", internal: 1n }] });
    expect(healthBps(s, NOW)).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: "mystery.testnet" },
    });
  });

  it("returns unsupported_asset for a debt asset with volatility ratio 0", () => {
    const s = baseSnapshot();
    s.assets[USDC] = { ...usdcAsset, volatilityRatioBps: 0 };
    expect(healthBps(s, NOW)).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: USDC },
    });
  });

  it("states that a default_price asset is fixed and skips the price freshness check", () => {
    const fixed = (p: typeof wnearPrice) => ({
      ...p,
      source: "default_price" as const,
      publishTimeMs: null,
    });
    // The balances must still be fresh: a fixed price has no age, the read does.
    const later = NOW + 10 * 3_600_000;
    const s = baseSnapshot({
      prices: { [WNEAR]: fixed(wnearPrice), [USDC]: fixed(usdcPrice) },
      readAtMs: later,
    });
    const r = health(s, later);
    expect(r.value).toBe(14_250);
    expect(r.assumptions).toContain("wNEAR uses a fixed price");
    expect(r.assumptions).toContain("USDC uses a fixed price");
  });

  it("treats an oracle price with no publish time as missing", () => {
    const s = baseSnapshot({
      prices: { [WNEAR]: { ...wnearPrice, publishTimeMs: null }, [USDC]: usdcPrice },
    });
    expect(healthBps(s, NOW)).toEqual({
      ok: false,
      error: { kind: "missing_price", tokenId: WNEAR },
    });
  });

  it("sums duplicate lines of the same token", () => {
    const s = baseSnapshot({
      collateral: [
        { tokenId: WNEAR, internal: 40n * 10n ** 24n },
        { tokenId: WNEAR, internal: 60n * 10n ** 24n },
      ],
    });
    expect(health(s).value).toBe(14_250);
  });
});

describe("liquidationPrice", () => {
  it("solves health = 100% for the collateral price, rounded up", () => {
    // Need C = B = $210.526...  =>  100 wNEAR * p * 0.6 = 210.526 => p = $3.508771929...
    // multiplier = ceil(210.526... * 10^28 / (100 * 10^24 * 0.6))
    const r = liquidationPrice(baseSnapshot(), WNEAR, NOW);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const m = r.value.value.multiplier;
    expect(r.value.value.decimals).toBe(28);
    // B = 4000/19 USD  =>  m = ceil(4000/19 * 1e28 / (60 * 1e24)) = ceil(35087.719...) = 35088
    expect(m).toBe(35_088n);
  });

  it("flips health across the threshold exactly at the returned multiplier", () => {
    const base = baseSnapshot();
    const r = liquidationPrice(base, WNEAR, NOW);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const m = r.value.value.multiplier;
    const at = (mult: bigint) =>
      health(
        baseSnapshot({
          prices: { [WNEAR]: { ...wnearPrice, multiplier: mult }, [USDC]: usdcPrice },
        }),
      ).value as number;
    expect(at(m)).toBeGreaterThanOrEqual(10_000);
    expect(at(m - 1n)).toBeLessThan(10_000);
  });

  it("is 0 when the other collateral already covers the debt", () => {
    const r = liquidationPrice(baseSnapshot({ borrowed: [] }), WNEAR, NOW);
    expect(r.ok && r.value.value.multiplier).toBe(0n);
  });

  it("returns unsupported_asset for a token that is not collateral", () => {
    expect(liquidationPrice(baseSnapshot(), USDC, NOW)).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: USDC },
    });
  });

  it("propagates stale and missing prices", () => {
    const s = baseSnapshot();
    delete s.prices[USDC];
    expect(liquidationPrice(s, WNEAR, NOW)).toEqual({
      ok: false,
      error: { kind: "missing_price", tokenId: USDC },
    });
  });
});
