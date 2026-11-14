import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardDraft } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { ONLY_REPAY_MSG, repayPayload } from "../src/tx/repay";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/encodings.json"), "utf8"),
) as {
  cases: {
    name: string;
    args_json: string;
    deposit: string;
    method: string;
    receiver_id: string;
  }[];
};
const vec = (n: string) => {
  const c = vectors.cases.find((x) => x.name === n);
  if (!c) throw new Error(n);
  return c;
};

const LENDING = "contract.1689937928.burrow.testnet";
const USDC = "usdc.fakes.testnet";
const FEE = {
  label: "Execution fee",
  amount: 100_000n,
  tokenId: USDC,
  recipientId: "fees.testnet",
  when: "Once.",
};
const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  action: "repay",
  headline: "Repay 50 USDC",
  numbers: [],
  assumptions: [],
  fees: [FEE],
  risks: [],
  dataAgeMs: 0,
  maxDataAgeMs: 120_000,
  amount: 50_000_000n,
  tokenId: USDC,
  cappedBy: null,
  ...over,
});
const build = (d: CardDraft, p: Partial<Parameters<typeof repayPayload>[1]> = {}) =>
  repayPayload(d, {
    lendingId: LENDING,
    recipientRegistered: true,
    lendingVersion: "0.16.2",
    extraDecimals: 12,
    ...p,
  });

describe("ONLY_REPAY_MSG", () => {
  it("is the JSON string OnlyRepay inside the msg string", () => {
    expect(ONLY_REPAY_MSG).toBe('"OnlyRepay"');
    expect(ONLY_REPAY_MSG).toBe('"OnlyRepay"');
  });
});

describe("repayPayload", () => {
  it("uses the proven legacy Execute/Repay encoding with internal units", () => {
    const r = build(draft({ fees: [] }), { lendingVersion: "0.11.0" });
    expect(r.ok && r.value[0]?.actions[0]?.args).toEqual({
      receiver_id: LENDING,
      amount: "50000000",
      msg: '{"Execute":{"actions":[{"Repay":{"token_id":"usdc.fakes.testnet","max_amount":"50000000000000000000"}}]}}',
    });
    expect(r.ok && JSON.stringify(r.value[0]?.actions[0]?.args)).toBe(
      vec("wallet_repay_legacy").args_json,
    );
    expect(r.ok && r.value[0]?.receiverId).toBe(vec("wallet_repay_legacy").receiver_id);
    expect(r.ok && r.value[0]?.actions[0]?.methodName).toBe(vec("wallet_repay_legacy").method);
    expect(r.ok && r.value[0]?.actions[0]?.deposit).toBe(
      BigInt(vec("wallet_repay_legacy").deposit),
    );
  });
  it("refuses absent or unproven versions instead of guessing", () => {
    expect(build(draft(), { lendingVersion: "0.15.7" }).ok).toBe(false);
    expect(build(draft(), { lendingVersion: "" }).ok).toBe(false);
  });
  it("refuses invalid extra decimals and legacy internal u128 overflow", () => {
    for (const extraDecimals of [-1, 1.5, 39])
      expect(build(draft(), { lendingVersion: "0.11.0", extraDecimals }).ok).toBe(false);
    expect(build(draft(), { lendingVersion: "0.11.0", extraDecimals: 38 }).ok).toBe(false);
  });
  it("repays through ft_transfer_call on the debt token, byte for byte", () => {
    const r = build(draft());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const repay = r.value[0];
    const c = vec("wallet_repay");
    expect(repay?.receiverId).toBe(c.receiver_id);
    expect(repay?.actions[0]?.methodName).toBe(c.method);
    expect(JSON.stringify(repay?.actions[0]?.args)).toBe(c.args_json);
    expect(repay?.actions[0]?.deposit).toBe(BigInt(c.deposit));
  });

  it("puts the fee after the repay so a failed repay is not followed by a fee request", () => {
    const r = build(draft());
    expect(r.ok && r.value.map((t) => t.actions[0]?.methodName)).toEqual([
      "ft_transfer_call",
      "ft_transfer",
    ]);
    if (r.ok)
      expect(JSON.stringify(r.value[1]?.actions[0]?.args)).toBe(vec("fee_transfer").args_json);
  });

  it("is a single transaction when there is no fee", () => {
    const r = build(draft({ fees: [] }));
    expect(r.ok && r.value).toHaveLength(1);
  });

  it("registers an unregistered fee recipient before the repay's fee", () => {
    const r = build(draft(), {
      lendingId: LENDING,
      recipientRegistered: false,
      storageDepositYocto: 1_250_000_000_000_000_000_000n,
    });
    expect(r.ok && r.value.map((t) => t.actions[0]?.methodName)).toEqual([
      "ft_transfer_call",
      "storage_deposit",
      "ft_transfer",
    ]);
  });

  it("refuses an unregistered recipient with no known deposit", () => {
    expect(build(draft(), { lendingId: LENDING, recipientRegistered: false }).ok).toBe(false);
  });

  it("sends token atomic units, not Rhea internal units", () => {
    // USDC has 12 extra decimals in Rhea; the transfer amount must not carry them.
    const r = build(draft({ amount: 50_000_000n }));
    expect(r.ok && r.value[0]?.actions[0]?.args.amount).toBe("50000000");
  });

  it("refuses a card that is not a repay", () => {
    expect(build(draft({ action: "guardian_activate" })).ok).toBe(false);
  });

  it("refuses a zero amount and a bad lending id", () => {
    expect(build(draft({ amount: 0n })).ok).toBe(false);
    expect(build(draft(), { lendingId: "Not An Id", recipientRegistered: true }).ok).toBe(false);
  });

  it("takes the token and amount only from the draft", () => {
    const r = build(draft({ tokenId: "dai.fakes.testnet", amount: 7n, fees: [] }));
    expect(r.ok && r.value[0]?.receiverId).toBe("dai.fakes.testnet");
    expect(r.ok && r.value[0]?.actions[0]?.args.amount).toBe("7");
  });
});
