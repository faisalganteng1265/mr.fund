import { expect, it } from "vitest";
import fixture from "../../../fixtures/trigger-vectors.json";
import { healthBps } from "../src/health";
import { baseSnapshot, NOW, USDC, WNEAR, wnearAsset } from "./helpers";

it.each(fixture.cases)("matches the shared Rust trigger vector: $name", (vector) => {
  const s = baseSnapshot();
  s.assets[WNEAR] = {
    ...wnearAsset,
    token: { id: WNEAR, symbol: "COL", decimals: 6, extraDecimals: 0 },
  };
  s.prices[WNEAR] = {
    multiplier: BigInt(vector.collateralPriceMultiplier ?? "50000"),
    decimals: 10,
    source: "oracle",
    publishTimeMs: NOW,
  };
  s.collateral = [{ tokenId: WNEAR, internal: BigInt(vector.collateralInternal) }];
  s.borrowed = [{ tokenId: USDC, internal: BigInt(vector.debtInternal) }];
  const result = healthBps(s, NOW);
  expect(result.ok && result.value.value).toBe(vector.healthBps);
});

// Independent published-source model, not a deployed health-factor view.
// The protocol scales values to 27 decimals and adds MAX_RATIO/2 before
// mul_ratio/div_ratio divisions (burrowland 2110c70, big_decimal.rs).
it.each(fixture.cases)("records published-source rounding separately: $name", (vector) => {
  const c =
    BigInt(vector.collateralInternal) *
    BigInt(vector.collateralPriceMultiplier ?? "50000") *
    10n ** 17n;
  const d = BigInt(vector.debtInternal) * 10000n * 10n ** 5n;
  const adjustedCollateral = (c * 6000n + 5000n) / 10000n;
  const adjustedDebt = (d * 10000n + 5000n) / 9500n;
  const publishedSourceBps = (adjustedCollateral * 10000n) / adjustedDebt;
  expect(publishedSourceBps).toBe(BigInt(vector.publishedSourceBps ?? vector.healthBps));
  const difference = BigInt(vector.healthBps) - publishedSourceBps;
  expect(difference >= 0n && difference <= 1n).toBe(true);
});
