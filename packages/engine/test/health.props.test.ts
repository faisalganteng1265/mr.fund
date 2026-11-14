import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { healthBps } from "../src/health";
import { baseSnapshot, NOW, USDC, usdcPrice, WNEAR, wnearPrice } from "./helpers";

/** Rank so that "no_debt" is the highest possible health. */
function rank(r: ReturnType<typeof healthBps>): number {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.value === "no_debt" ? Number.POSITIVE_INFINITY : r.value.value;
}

const collateral = fc.bigInt({ min: 1n, max: 10n ** 30n });
const debt = fc.bigInt({ min: 2n, max: 10n ** 24n });
const multiplier = fc.bigInt({ min: 1n, max: 10n ** 9n });

const snap = (c: bigint, d: bigint, m: bigint) =>
  baseSnapshot({
    collateral: [{ tokenId: WNEAR, internal: c }],
    borrowed: [{ tokenId: USDC, internal: d }],
    prices: { [WNEAR]: { ...wnearPrice, multiplier: m }, [USDC]: usdcPrice },
  });

describe("health properties", () => {
  it("more collateral never lowers health", () => {
    fc.assert(
      fc.property(collateral, collateral, debt, multiplier, (c, extra, d, m) => {
        expect(rank(healthBps(snap(c + extra, d, m), NOW))).toBeGreaterThanOrEqual(
          rank(healthBps(snap(c, d, m), NOW)),
        );
      }),
    );
  });

  it("repaying never lowers health", () => {
    fc.assert(
      fc.property(collateral, debt, fc.nat(), multiplier, (c, d, cut, m) => {
        const repaid = d - (BigInt(cut) % d);
        expect(rank(healthBps(snap(c, repaid, m), NOW))).toBeGreaterThanOrEqual(
          rank(healthBps(snap(c, d, m), NOW)),
        );
      }),
    );
  });

  it("a lower collateral price never raises health", () => {
    fc.assert(
      fc.property(collateral, debt, multiplier, multiplier, (c, d, m1, m2) => {
        const [lo, hi] = m1 <= m2 ? [m1, m2] : [m2, m1];
        expect(rank(healthBps(snap(c, d, lo), NOW))).toBeLessThanOrEqual(
          rank(healthBps(snap(c, d, hi), NOW)),
        );
      }),
    );
  });
});
