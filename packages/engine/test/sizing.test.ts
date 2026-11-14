import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { healthBps } from "../src/health";
import { maxRepayUseful, repayToReachHealth, withRepay } from "../src/sizing";
import { baseSnapshot, NOW, USDC, usdcPrice, WNEAR, wnearPrice } from "./helpers";

describe("maxRepayUseful", () => {
  it("converts internal debt to atomic units", () => {
    const r = maxRepayUseful(baseSnapshot(), USDC, NOW);
    expect(r.ok && r.value.value).toBe(200_000_000n);
  });

  it("rounds up so repaying the result clears the debt", () => {
    const s = baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 200n * 10n ** 18n + 1n }] });
    const r = maxRepayUseful(s, USDC, NOW);
    expect(r.ok && r.value.value).toBe(200_000_001n);
  });

  it("is 0 without debt in that token and errors for an unknown token", () => {
    const none = maxRepayUseful(baseSnapshot({ borrowed: [] }), USDC, NOW);
    expect(none.ok && none.value.value).toBe(0n);
    expect(maxRepayUseful(baseSnapshot(), "mystery.testnet", NOW)).toEqual({
      ok: false,
      error: { kind: "unsupported_asset", tokenId: "mystery.testnet" },
    });
  });
});

describe("repayToReachHealth", () => {
  it("finds the smallest repay that reaches 150%", () => {
    // C = $300 ; health 1.5 needs B = $200 => debt $190 => repay 10 USDC
    const r = repayToReachHealth(baseSnapshot(), USDC, 15_000, NOW);
    expect(r.ok && r.value.value).toBe(10_000_000n);
  });

  it("is minimal: health at the result reaches the target, one atomic unit less does not", () => {
    const s = baseSnapshot();
    const r = repayToReachHealth(s, USDC, 15_000, NOW);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const n = r.value.value;
    const h = (amount: bigint) => {
      const x = healthBps(withRepay(s, USDC, amount), NOW);
      if (!x.ok) throw new Error(JSON.stringify(x.error));
      return x.value.value;
    };
    expect(h(n)).toBeGreaterThanOrEqual(15_000);
    expect(h(n - 1n)).toBeLessThan(15_000);
  });

  it("is 0 when health already meets the target", () => {
    const r = repayToReachHealth(baseSnapshot(), USDC, 14_250, NOW);
    expect(r.ok && r.value.value).toBe(0n);
  });

  it("returns the full debt when only a full repay reaches the target", () => {
    const r = repayToReachHealth(baseSnapshot(), USDC, Number.MAX_SAFE_INTEGER, NOW);
    expect(r.ok && r.value.value).toBe(200_000_000n);
  });

  it("errors when repaying this token cannot reach the target", () => {
    const s = baseSnapshot();
    s.assets["dai.testnet"] = {
      token: { id: "dai.testnet", symbol: "DAI", decimals: 18, extraDecimals: 0 },
      volatilityRatioBps: 9000,
      supplyAprBps: 0,
      borrowAprBps: 0,
      canBorrow: true,
      canUseAsCollateral: false,
    };
    s.prices["dai.testnet"] = {
      multiplier: 10_000n,
      decimals: 22,
      publishTimeMs: NOW,
      source: "oracle",
    };
    s.borrowed.push({ tokenId: "dai.testnet", internal: 400n * 10n ** 18n });
    const r = repayToReachHealth(s, USDC, 20_000, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("target_unreachable");
  });

  it("rejects a non-positive or fractional target", () => {
    for (const t of [0, -1, 1.5]) {
      const r = repayToReachHealth(baseSnapshot(), USDC, t, NOW);
      expect(r.ok).toBe(false);
    }
  });

  it("propagates stale prices", () => {
    const s = baseSnapshot();
    s.prices[WNEAR] = { ...wnearPrice, publishTimeMs: NOW - 120_001 };
    expect(repayToReachHealth(s, USDC, 15_000, NOW).ok).toBe(false);
  });

  it("is minimal for random positions and targets", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 10n ** 20n, max: 10n ** 30n }),
        fc.bigInt({ min: 10n ** 8n, max: 10n ** 24n }),
        fc.integer({ min: 10_001, max: 60_000 }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (c, d, target, m) => {
          const s = baseSnapshot({
            collateral: [{ tokenId: WNEAR, internal: c }],
            borrowed: [{ tokenId: USDC, internal: d }],
            prices: { [WNEAR]: { ...wnearPrice, multiplier: m }, [USDC]: usdcPrice },
          });
          const r = repayToReachHealth(s, USDC, target, NOW);
          if (!r.ok) throw new Error(`a single debt must be reachable: ${JSON.stringify(r.error)}`);
          const n = r.value.value;
          const rank = (amount: bigint) => {
            const x = healthBps(withRepay(s, USDC, amount), NOW);
            if (!x.ok) throw new Error("unexpected");
            return x.value.value === "no_debt" ? Number.POSITIVE_INFINITY : x.value.value;
          };
          expect(rank(n)).toBeGreaterThanOrEqual(target);
          if (n > 0n) expect(rank(n - 1n)).toBeLessThan(target);
        },
      ),
    );
  });
});
