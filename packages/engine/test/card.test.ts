import type { CardDraft, FeeSchedule } from "@mrfund/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assembleCard, canExecute, repayCard } from "../src/card";
import { MAX_DATA_AGE_MS } from "../src/health";
import { baseSnapshot, NOW, USDC, WNEAR } from "./helpers";

const FEES: FeeSchedule = {
  tokenId: USDC,
  recipientId: "fees.testnet",
  activationFee: 0n,
  actionFee: 0n,
  executionFee: 100_000n,
};
const NO_FEES: FeeSchedule = { ...FEES, executionFee: 0n };
const USDC_1 = 1_000_000n;
const WALLET = 1_000n * USDC_1;

function draft(amount: bigint, wallet = WALLET, schedule = FEES, s = baseSnapshot()): CardDraft {
  const r = repayCard(s, { tokenId: USDC, amount, walletBalance: wallet }, schedule, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const num = (d: CardDraft, label: string) => d.numbers.find((n) => n.label === label);

// Base position: 100 wNEAR at $5, ratio 60%; 200 USDC debt at 21% APR; health 14250 bps.
describe("repayCard numbers", () => {
  const d = draft(50n * USDC_1);

  it("states the action and a plain headline", () => {
    expect(d.action).toBe("repay");
    expect(d.headline).toBe("Repay 50 USDC");
    expect(d.tokenId).toBe(USDC);
    expect(d.amount).toBe(50n * USDC_1);
    expect(d.cappedBy).toBeNull();
  });

  it("shows debt before and after", () => {
    expect(num(d, "Debt")).toEqual({ label: "Debt", before: "200", after: "150", unit: "USDC" });
  });

  it("shows health before and after, rounded down", () => {
    // 300 * 0.95 / 150 = 1.9 exactly.
    expect(num(d, "Health factor")).toEqual({
      label: "Health factor",
      before: "142.5",
      after: "190",
      unit: "%",
    });
  });

  it("shows the liquidation price before and after, and it falls when debt falls", () => {
    const n = num(d, "wNEAR liquidation price");
    expect(n?.unit).toBe("USD");
    expect(n?.before?.startsWith("3.508")).toBe(true);
    expect(n?.after?.startsWith("2.631")).toBe(true);
  });

  it("shows the yearly interest cost before and after, rounded up", () => {
    // 21% of 200 = 42; 21% of 150 = 31.5
    expect(num(d, "Annual interest cost")).toEqual({
      label: "Annual interest cost",
      before: "42",
      after: "31.5",
      unit: "USDC",
    });
  });

  it("rounds interest cost up", () => {
    const s = baseSnapshot();
    const r = repayCard(s, { tokenId: USDC, amount: 1n, walletBalance: WALLET }, NO_FEES, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // After 199_999_999: 41_999_999.79 rounds up to 42, so a tiny repay shows no saving.
      expect(num(r.value, "Annual interest cost")?.after).toBe("42");
    }
  });

  it("carries data age, the limit, assumptions and static risks", () => {
    expect(d.dataAgeMs).toBe(0);
    expect(d.maxDataAgeMs).toBe(MAX_DATA_AGE_MS);
    expect(d.assumptions.join(" ")).toMatch(/rounds down/i);
    expect(d.assumptions.join(" ")).toMatch(/without compounding/i);
    expect(d.risks).toContain("Rates change.");
    expect(d.risks).toContain("Repaying lowers liquidation risk; it does not remove it.");
  });

  it("lists the execution fee with its recipient", () => {
    expect(d.fees).toEqual([
      {
        label: "Execution fee",
        amount: 100_000n,
        tokenId: USDC,
        recipientId: "fees.testnet",
        when: "Once, in the same signed batch as the repay.",
      },
    ]);
  });

  it("omits a zero fee and says so", () => {
    const z = draft(50n * USDC_1, WALLET, NO_FEES);
    expect(z.fees).toEqual([]);
    expect(z.assumptions).toContain("No execution fee is charged.");
  });
});

describe("repayCard bounds (Adjust)", () => {
  it("caps at the outstanding debt and says so", () => {
    const d = draft(999n * USDC_1);
    expect(d.amount).toBe(200n * USDC_1);
    expect(d.cappedBy).toBe("debt");
    expect(d.risks.join(" ")).toMatch(/outstanding debt/);
  });

  it("caps at the wallet balance and says so", () => {
    const d = draft(150n * USDC_1, 30n * USDC_1, NO_FEES);
    expect(d.amount).toBe(30n * USDC_1);
    expect(d.cappedBy).toBe("wallet");
    expect(d.risks.join(" ")).toMatch(/wallet balance/);
  });

  it("names the debt when both limits are exceeded and the debt is smaller", () => {
    expect(draft(999n * USDC_1, 5_000n * USDC_1).cappedBy).toBe("debt");
    expect(draft(999n * USDC_1, 100n * USDC_1).cappedBy).toBe("wallet");
  });

  it("is not capped at exactly the limit", () => {
    expect(draft(200n * USDC_1).cappedBy).toBeNull();
    expect(draft(30n * USDC_1, 30n * USDC_1, NO_FEES).cappedBy).toBeNull();
  });

  it("recomputes every number when the amount is adjusted", () => {
    const a = draft(50n * USDC_1);
    const b = draft(100n * USDC_1);
    expect(num(b, "Debt")?.after).toBe("100");
    expect(num(b, "Health factor")?.after).not.toBe(num(a, "Health factor")?.after);
    expect(b.headline).toBe("Repay 100 USDC");
  });

  it("a full repay leaves no debt and no health factor", () => {
    const d = draft(200n * USDC_1);
    expect(num(d, "Debt")?.after).toBe("0");
    expect(num(d, "Health factor")?.after).toBeUndefined();
    expect(num(d, "Annual interest cost")?.after).toBe("0");
    expect(d.assumptions).toContain("No debt remains after this repay.");
  });

  it("warns when health stays below the liquidation line after the repay", () => {
    const s = baseSnapshot({
      borrowed: [{ tokenId: USDC, internal: 400n * USDC_1 * 10n ** 12n }],
    });
    const d = draft(1n * USDC_1, WALLET, NO_FEES, s);
    expect(d.risks.join(" ")).toMatch(/below the liquidation line/);
  });
});

describe("repayCard edge cases", () => {
  const warns = (d: CardDraft) => d.risks.some((r) => /below the liquidation line/.test(r));

  it("warns at 9999 bps after the repay but not at exactly 10000", () => {
    // Health = 285 / debt in USDC. Debt 285.000002 minus 1 atomic = 285.000001 -> 9999; 285.000001 minus 1 = 285 -> 10000.
    const at = (internal: bigint) =>
      draft(
        1n,
        WALLET,
        NO_FEES,
        baseSnapshot({ borrowed: [{ tokenId: USDC, internal: internal * 10n ** 12n }] }),
      );
    expect(warns(at(285_000_002n))).toBe(true);
    expect(warns(at(285_000_001n))).toBe(false);
  });

  it("omits the liquidation price when other collateral already covers the debt", () => {
    const b = baseSnapshot();
    const wn = b.assets[WNEAR];
    const wp = b.prices[WNEAR];
    if (!wn || !wp) throw new Error("fixture");
    const OTHER = "other.testnet";
    const s = baseSnapshot({
      collateral: [...b.collateral, { tokenId: OTHER, internal: 1_000_000n * 10n ** 24n }],
      assets: {
        ...b.assets,
        [OTHER]: { ...wn, token: { ...wn.token, id: OTHER, symbol: "OTHR" } },
      },
      prices: { ...b.prices, [OTHER]: wp },
    });
    const d = draft(50n * USDC_1, WALLET, NO_FEES, s);
    expect(d.numbers.some((n) => n.label.endsWith("liquidation price"))).toBe(false);
  });

  it("reports a custom data-age limit on the card", () => {
    const r = repayCard(
      baseSnapshot(),
      { tokenId: USDC, amount: USDC_1, walletBalance: WALLET },
      NO_FEES,
      NOW,
      { maxDataAgeMs: 5_000 },
    );
    expect(r.ok && r.value.maxDataAgeMs).toBe(5_000);
  });

  it("reports the age of the data it used", () => {
    const r = repayCard(
      baseSnapshot(),
      { tokenId: USDC, amount: USDC_1, walletBalance: WALLET },
      NO_FEES,
      NOW + 45_000,
    );
    expect(r.ok && r.value.dataAgeMs).toBe(45_000);
  });
});

describe("repayCard when the fee is paid in the token being repaid", () => {
  it("keeps the fee out of the repay so the second transfer cannot fail", () => {
    // Wallet 30 USDC, fee 0.1 USDC: at most 29.9 can be repaid.
    const d = draft(30n * USDC_1, 30n * USDC_1);
    expect(d.amount).toBe(29_900_000n);
    expect(d.cappedBy).toBe("wallet");
  });

  it("does not reserve a fee that is paid in another token", () => {
    const other: FeeSchedule = { ...FEES, tokenId: "dai.fakes.testnet" };
    expect(draft(30n * USDC_1, 30n * USDC_1, other).amount).toBe(30n * USDC_1);
  });

  it("does not reserve anything when there is no fee", () => {
    expect(draft(30n * USDC_1, 30n * USDC_1, NO_FEES).amount).toBe(30n * USDC_1);
  });

  it("refuses when the wallet cannot even cover the fee", () => {
    for (const wallet of [100_000n, 50_000n]) {
      const r = repayCard(
        baseSnapshot(),
        { tokenId: USDC, amount: USDC_1, walletBalance: wallet },
        FEES,
        NOW,
      );
      expect(r.ok === false && r.error.kind).toBe("invalid_amount");
    }
    expect(
      repayCard(
        baseSnapshot(),
        { tokenId: USDC, amount: USDC_1, walletBalance: 100_001n },
        FEES,
        NOW,
      ).ok,
    ).toBe(true);
  });
});

describe("assembleCard", () => {
  const payload = [
    {
      receiverId: USDC,
      actions: [
        {
          methodName: "ft_transfer_call",
          args: {
            receiver_id: "contract.1689937928.burrow.testnet",
            amount: "50000000",
            msg: '"OnlyRepay"',
          },
          gas: 100_000_000_000_000n,
          deposit: 1n,
        },
      ],
    },
  ];
  const json = (v: unknown) =>
    JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

  it("combines the draft, the builder payload and the reason", () => {
    const d = draft(50n * USDC_1);
    const c = assembleCard(d, { id: "card-1", reason: "Your health is low.", payload });
    expect(c.id).toBe("card-1");
    expect(c.reason).toBe("Your health is low.");
    expect(c.headline).toBe(d.headline);
    expect(c.numbers).toEqual(d.numbers);
    expect(c.payload).toBe(payload);
    expect(c.receipt).toBeUndefined();
    expect("amount" in c).toBe(false);
  });

  it("property: no reason text can change the payload bytes or any number", () => {
    const d = draft(50n * USDC_1);
    const baseline = assembleCard(d, { id: "c", reason: "", payload });
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (reason) => {
        const c = assembleCard(d, { id: "c", reason, payload });
        expect(json(c.payload)).toBe(json(baseline.payload));
        expect(json(c.numbers)).toBe(json(baseline.numbers));
        expect(json(c.fees)).toBe(json(baseline.fees));
        expect(c.headline).toBe(baseline.headline);
      }),
      { numRuns: 300 },
    );
  });

  it("property: hostile reasons that look like JSON or payloads stay prose", () => {
    const d = draft(50n * USDC_1);
    const baseline = json(payload);
    fc.assert(
      fc.property(
        fc.json(),
        fc.constantFrom("amount", "receiver_id", "msg", "ft_transfer"),
        (j, key) => {
          const c = assembleCard(d, { id: "c", reason: `${key}: ${j}`, payload });
          expect(json(c.payload)).toBe(baseline);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("repayCard refusals", () => {
  const call = (amount: bigint, wallet: bigint, s = baseSnapshot(), now = NOW, token = USDC) =>
    repayCard(s, { tokenId: token, amount, walletBalance: wallet }, FEES, now);

  it("refuses a zero or negative amount", () => {
    for (const a of [0n, -1n]) {
      const r = call(a, WALLET);
      expect(r.ok === false && r.error.kind).toBe("invalid_amount");
    }
  });

  it("refuses when the wallet holds none of the token", () => {
    expect(call(1n, 0n).ok).toBe(false);
    expect(call(1n, -1n).ok).toBe(false);
  });

  it("refuses a token with no debt or no config", () => {
    expect(call(1n, WALLET, baseSnapshot({ borrowed: [] })).ok).toBe(false);
    const r = call(1n, WALLET, baseSnapshot(), NOW, "nope.testnet");
    expect(r.ok === false && r.error.kind).toBe("unsupported_asset");
  });

  it("refuses stale data instead of building a card", () => {
    const r = call(1n, WALLET, baseSnapshot(), NOW + MAX_DATA_AGE_MS + 1);
    expect(r.ok === false && r.error.kind).toBe("stale_snapshot");
  });

  it("refuses prices that went stale", () => {
    const s = baseSnapshot({ readAtMs: NOW + 600_000 });
    const r = call(1n, WALLET, s, NOW + 600_000);
    expect(r.ok === false && r.error.kind).toBe("stale_price");
  });
});

describe("canExecute", () => {
  const base = {
    dataAgeMs: 10_000,
    maxDataAgeMs: MAX_DATA_AGE_MS,
    payload: [{ receiverId: USDC, actions: [] }],
  };

  it("enables execution while the oldest input is within the limit", () => {
    expect(canExecute(base, 0)).toEqual({ enabled: true });
    expect(canExecute(base, MAX_DATA_AGE_MS - 10_000)).toEqual({ enabled: true });
  });

  it("disables one millisecond past the limit, counting time since the card was built", () => {
    expect(canExecute(base, MAX_DATA_AGE_MS - 10_000 + 1)).toEqual({
      enabled: false,
      reason: "stale_data",
    });
  });

  it("disables a card that has no builder payload", () => {
    expect(canExecute({ ...base, payload: [] }, 0)).toEqual({
      enabled: false,
      reason: "no_payload",
    });
  });

  it("treats a negative elapsed time as zero, never as extra freshness", () => {
    expect(canExecute(base, -5_000)).toEqual({ enabled: true });
    const old = { ...base, dataAgeMs: MAX_DATA_AGE_MS + 1_000 };
    expect(canExecute(old, -5_000)).toEqual({ enabled: false, reason: "stale_data" });
  });
});
