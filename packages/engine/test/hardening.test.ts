import type { GuardianPolicy, GuardianState, PositionSnapshot } from "@mrfund/shared";
import { parseAtomic } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { healthBps, liquidationPrice, MAX_DATA_AGE_MS } from "../src/health";
import { mood } from "../src/mood";
import { repayToReachHealth, withRepay } from "../src/sizing";
import { evaluateTrigger } from "../src/trigger";
import { baseSnapshot, NOW, USDC, WNEAR } from "./helpers";

// Findings from the independent review of the engine (2026-11-05).

const policy: GuardianPolicy = {
  maxPerAction: 100_000_000n,
  lifetimeCap: 500_000_000n,
  reserveFloor: 50_000_000n,
  triggerHfBps: 12_000,
  targetHfBps: 15_000,
  cooldownSec: 300,
  actionFee: 1_000_000n,
};
const guardian: GuardianState = {
  status: "active",
  ownerId: "alice.testnet",
  watcherId: "watcher.testnet",
  debtTokenId: USDC,
  reserve: 1_000_000_000n,
  spentTotal: 0n,
  inFlight: null,
  lastActionStartedNs: 0n,
};
/** Health 11400 bps, below the 12000 trigger. */
const risky = () =>
  baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 250n * 10n ** 6n * 10n ** 12n }] });

const trig = (p: Partial<GuardianPolicy> = {}, g: Partial<GuardianState> = {}, now = NOW) =>
  evaluateTrigger(risky(), { ...policy, ...p }, { ...guardian, ...g }, now);

describe("trigger refuses a malformed policy instead of spending the maximum", () => {
  it("accepts the reference policy", () => {
    const r = trig();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.act).toBe(true);
  });

  it.each([
    ["target 0", { targetHfBps: 0 }],
    ["negative target", { targetHfBps: -5 }],
    ["fractional target", { targetHfBps: 15_000.5 }],
    ["target equal to trigger", { targetHfBps: 12_000 }],
    ["target below trigger", { targetHfBps: 11_000 }],
    ["trigger below the contract minimum", { triggerHfBps: 10_499, targetHfBps: null }],
    ["fractional trigger", { triggerHfBps: 12_000.5 }],
    ["cooldown below the minimum", { cooldownSec: 299 }],
    ["fractional cooldown", { cooldownSec: 300.5 }],
    ["zero max per action", { maxPerAction: 0n }],
    ["cap below max per action", { lifetimeCap: 99_999_999n }],
    ["negative floor", { reserveFloor: -1n }],
    ["negative fee", { actionFee: -1n }],
  ] as [string, Partial<GuardianPolicy>][])("%s", (_name, p) => {
    const r = trig(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_input");
  });

  it("accepts the exact minimums", () => {
    expect(trig({ triggerHfBps: 10_500, targetHfBps: null, cooldownSec: 300 }).ok).toBe(true);
    expect(trig({ targetHfBps: 12_001 }).ok).toBe(true);
    expect(trig({ lifetimeCap: 100_000_000n }).ok).toBe(true);
  });

  it("checks the policy before anything else, even when the Guardian is paused", () => {
    const r = trig({ targetHfBps: 0 }, { status: "paused" });
    expect(r.ok).toBe(false);
  });
});

/** Collateral worth $3 adjusted against 200 USDC plus 200 DAI: repaying USDC alone cannot reach 150%. */
function twoDebts(): PositionSnapshot {
  const b = baseSnapshot();
  const usdc = b.assets[USDC];
  const usdcP = b.prices[USDC];
  if (!usdc || !usdcP) throw new Error("fixture");
  const DAI = "dai.testnet";
  return baseSnapshot({
    collateral: [{ tokenId: WNEAR, internal: 100n * 10n ** 24n }],
    borrowed: [
      { tokenId: USDC, internal: 200n * 10n ** 6n * 10n ** 12n },
      { tokenId: DAI, internal: 200n * 10n ** 18n },
    ],
    assets: {
      ...b.assets,
      [DAI]: { ...usdc, token: { id: DAI, symbol: "DAI", decimals: 18, extraDecimals: 0 } },
    },
    prices: { ...b.prices, [DAI]: { ...usdcP, decimals: 22 } },
  });
}

describe("trigger clock and limits", () => {
  it("floors a fractional clock instead of throwing", () => {
    const r = trig({}, {}, NOW + 0.7);
    expect(r.ok).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("rejects clock %s", (now) => {
    const r = trig({}, {}, now);
    expect(r.ok).toBe(false);
  });

  it("waits out the cooldown exactly", () => {
    const nowNs = BigInt(NOW) * 1_000_000n;
    const at = (agoNs: bigint) => trig({}, { lastActionStartedNs: nowNs - agoNs });
    const edge = at(300n * 1_000_000_000n);
    expect(edge.ok && edge.value.act).toBe(true);
    const inside = at(300n * 1_000_000_000n - 1n);
    expect(inside.ok && inside.value).toEqual({ act: false, reason: "cooldown" });
  });

  it("clamps to one atomic unit when that is all the reserve room allows", () => {
    const r = trig({}, { reserve: policy.reserveFloor + policy.actionFee + 1n });
    expect(r.ok && r.value).toEqual({ act: true, amount: 1n, binding: "spendable" });
  });

  it("reports the reserve as exhausted at zero room", () => {
    const r = trig({}, { reserve: policy.reserveFloor + policy.actionFee });
    expect(r.ok && r.value).toEqual({ act: false, reason: "reserve_exhausted" });
  });

  it("still repays as much as the limits allow when the target is unreachable", () => {
    const r = evaluateTrigger(twoDebts(), { ...policy, targetHfBps: 30_000 }, guardian, NOW);
    expect(r.ok && r.value.act).toBe(true);
    if (r.ok && r.value.act) expect(r.value.amount).toBeGreaterThan(0n);
  });
});

describe("unreachable target has its own error", () => {
  it("is target_unreachable, not invalid_amount", () => {
    const r = repayToReachHealth(twoDebts(), USDC, 30_000, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("target_unreachable");
  });

  it("a bad target stays invalid_amount", () => {
    const r = repayToReachHealth(risky(), USDC, 0, NOW);
    expect(r.ok === false && r.error.kind).toBe("invalid_amount");
  });
});

describe("snapshot age is enforced, not only price age", () => {
  const fixed = (readAtMs: number): PositionSnapshot => {
    const b = baseSnapshot();
    const prices = Object.fromEntries(
      Object.entries(b.prices).map(([k, v]) => [
        k,
        { ...v, source: "default_price" as const, publishTimeMs: null },
      ]),
    );
    return { ...b, prices, readAtMs };
  };

  it("refuses balances read longer ago than the limit even with fixed prices", () => {
    const r = healthBps(fixed(NOW - 6 * 3_600_000), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("stale_snapshot");
  });

  it("refuses fresh oracle prices on an old read", () => {
    const s = { ...baseSnapshot(), readAtMs: NOW - MAX_DATA_AGE_MS - 1 };
    const r = healthBps(s, NOW);
    expect(r.ok === false && r.error.kind).toBe("stale_snapshot");
  });

  it("accepts a read exactly at the limit", () => {
    const s = { ...baseSnapshot(), readAtMs: NOW - MAX_DATA_AGE_MS };
    expect(healthBps(s, NOW).ok).toBe(true);
  });

  it("makes the character concerned and stops the trigger", () => {
    const old = fixed(NOW - 6 * 3_600_000);
    expect(mood(old, undefined, 14_000, NOW)).toEqual({ state: "concerned", reason: "stale_data" });
    const r = evaluateTrigger(old, policy, guardian, NOW);
    expect(r.ok).toBe(false);
  });

  it("honours a custom limit", () => {
    const s = { ...baseSnapshot(), readAtMs: NOW - 10_000 };
    expect(healthBps(s, NOW, { maxDataAgeMs: 5_000 }).ok).toBe(false);
  });
});

describe("snapshot validation at the boundary", () => {
  const base = baseSnapshot();
  const wn = base.assets[WNEAR];
  const wp = base.prices[WNEAR];
  if (!wn || !wp) throw new Error("fixture");

  const kind = (s: PositionSnapshot) => {
    const r = healthBps(s, NOW);
    return r.ok ? "ok" : r.error.kind;
  };

  it("rejects a negative balance", () => {
    expect(kind(baseSnapshot({ collateral: [{ tokenId: WNEAR, internal: -1n }] }))).toBe(
      "invalid_input",
    );
    expect(kind(baseSnapshot({ borrowed: [{ tokenId: USDC, internal: -1n }] }))).toBe(
      "invalid_input",
    );
  });

  it.each([-1, 10_001, 6000.5])("rejects volatility ratio %s", (ratio) => {
    const s = baseSnapshot({
      assets: { ...base.assets, [WNEAR]: { ...wn, volatilityRatioBps: ratio } },
    });
    expect(kind(s)).toBe("invalid_input");
  });

  it("rejects a non-integer price decimals", () => {
    const s = baseSnapshot({ prices: { ...base.prices, [WNEAR]: { ...wp, decimals: 28.5 } } });
    expect(kind(s)).toBe("invalid_input");
  });

  it("rejects a price dated well in the future but tolerates small skew", () => {
    const at = (t: number) =>
      baseSnapshot({ prices: { ...base.prices, [WNEAR]: { ...wp, publishTimeMs: t } } });
    expect(kind(at(NOW + 60_000))).toBe("ok");
    expect(kind(at(NOW + 60_001))).toBe("invalid_input");
  });

  it("rejects a read dated well in the future but tolerates small skew", () => {
    const at = (t: number) => ({ ...baseSnapshot(), readAtMs: t });
    expect(kind(at(NOW + 60_000))).toBe("ok");
    expect(kind(at(NOW + 60_001))).toBe("invalid_input");
  });

  it("returns an error, never throws, for liquidationPrice on bad input", () => {
    const s = baseSnapshot({ collateral: [{ tokenId: WNEAR, internal: -1n }] });
    expect(() => liquidationPrice(s, WNEAR, NOW)).not.toThrow();
    expect(liquidationPrice(s, WNEAR, NOW).ok).toBe(false);
  });
});

describe("liquidationPrice with other collateral covering the debt", () => {
  it("returns multiplier 0", () => {
    const wn = baseSnapshot().assets[WNEAR];
    const wp = baseSnapshot().prices[WNEAR];
    if (!wn || !wp) throw new Error("fixture");
    const OTHER = "other.testnet";
    const s = baseSnapshot({
      collateral: [
        { tokenId: WNEAR, internal: 100n * 10n ** 24n },
        { tokenId: OTHER, internal: 1_000_000n * 10n ** 24n },
      ],
      assets: { ...baseSnapshot().assets, [OTHER]: { ...wn, token: { ...wn.token, id: OTHER } } },
      prices: { ...baseSnapshot().prices, [OTHER]: wp },
    });
    const r = liquidationPrice(s, WNEAR, NOW);
    expect(r.ok && r.value.value.multiplier).toBe(0n);
  });
});

describe("withRepay", () => {
  it("rejects a negative amount, which would add debt", () => {
    expect(() => withRepay(baseSnapshot(), USDC, -1n)).toThrow(RangeError);
  });
});

describe("parseAtomic upper bound", () => {
  const U128_MAX = 2n ** 128n - 1n;
  it("accepts the largest u128 and rejects one more", () => {
    expect(parseAtomic(U128_MAX.toString()).ok).toBe(true);
    expect(parseAtomic((U128_MAX + 1n).toString()).ok).toBe(false);
  });
});
