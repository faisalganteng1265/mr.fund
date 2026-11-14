import type { CardDraft } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import {
  borrowPayload,
  collateralDepositPayload,
  MAX_REGISTRATION_YOCTO,
  OPENING_GAS,
  type OpeningPayloadParams,
} from "../src/tx/open-position";

const LENDING = "contract.1689937928.burrow.testnet";
const WRAP = "wrap.testnet";
const REF = "ref.fakes.testnet";
const USDC = "usdc.fakes.testnet";
const ME = "alice.testnet";
const FEES = "fees.testnet";

const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  action: "wallet_borrow",
  headline: "x",
  numbers: [],
  assumptions: [],
  fees: [],
  risks: [],
  dataAgeMs: 0,
  maxDataAgeMs: 120_000,
  amount: 500_000_000_000_000_000n,
  tokenId: REF,
  cappedBy: null,
  ...over,
});
const params = (over: Partial<OpeningPayloadParams> = {}): OpeningPayloadParams => ({
  lendingId: LENDING,
  lendingVersion: "0.11.0",
  accountId: ME,
  registrations: [],
  recipientRegistered: true,
  ...over,
});
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok)
    throw new Error(
      `expected ok, got ${JSON.stringify(r.error, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
  return r.value;
};

describe("collateralDepositPayload", () => {
  const deposit = (over: Partial<CardDraft> = {}) =>
    draft({ action: "wallet_collateral_deposit", tokenId: WRAP, amount: 5n * 10n ** 23n, ...over });

  it("is exactly one 1-yocto ft_transfer_call with only IncreaseCollateral (public Gate 1 shape)", () => {
    expect(unwrap(collateralDepositPayload(deposit(), params()))).toEqual([
      {
        receiverId: WRAP,
        actions: [
          {
            methodName: "ft_transfer_call",
            args: {
              receiver_id: LENDING,
              amount: "500000000000000000000000",
              msg: '{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":"wrap.testnet"}}]}}',
            },
            gas: OPENING_GAS,
            deposit: 1n,
          },
        ],
      },
    ]);
  });

  it("puts bounded registrations first, each with the exact deposit and the signer as account", () => {
    const p = unwrap(
      collateralDepositPayload(
        deposit(),
        params({ registrations: [{ contractId: LENDING, depositYocto: 10n ** 23n }] }),
      ),
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toEqual({
      receiverId: LENDING,
      actions: [
        {
          methodName: "storage_deposit",
          args: { account_id: ME, registration_only: true },
          gas: 30_000_000_000_000n,
          deposit: 10n ** 23n,
        },
      ],
    });
    expect(p[1]?.receiverId).toBe(WRAP);
  });

  it.each([
    ["a target outside the stage", { contractId: USDC, depositYocto: 1n }],
    ["a zero deposit", { contractId: LENDING, depositYocto: 0n }],
    ["a negative deposit", { contractId: LENDING, depositYocto: -1n }],
    ["an oversized deposit", { contractId: LENDING, depositYocto: MAX_REGISTRATION_YOCTO + 1n }],
    ["a non-bigint deposit", { contractId: LENDING, depositYocto: 5 as unknown as bigint }],
  ])("refuses %s", (_name, registration) => {
    expect(collateralDepositPayload(deposit(), params({ registrations: [registration] })).ok).toBe(
      false,
    );
  });

  it("refuses the same registration twice", () => {
    const r = { contractId: LENDING, depositYocto: 1n };
    expect(collateralDepositPayload(deposit(), params({ registrations: [r, r] })).ok).toBe(false);
  });

  it("refuses a repay or borrow draft, an unverified version and a zero amount", () => {
    expect(collateralDepositPayload(draft(), params()).ok).toBe(false);
    expect(collateralDepositPayload(deposit({ action: "repay" }), params()).ok).toBe(false);
    for (const lendingVersion of ["0.16.2", "0.12.0", ""])
      expect(collateralDepositPayload(deposit(), params({ lendingVersion })).ok).toBe(false);
    expect(collateralDepositPayload(deposit({ amount: 0n }), params()).ok).toBe(false);
    expect(collateralDepositPayload(deposit(), params({ accountId: "Not An Account" })).ok).toBe(
      false,
    );
  });

  it("appends the disclosed fee, registering an unregistered recipient first", () => {
    const fee = { label: "Fee", amount: 10_000n, tokenId: USDC, recipientId: FEES, when: "once" };
    const p = unwrap(
      collateralDepositPayload(
        deposit({ fees: [fee] }),
        params({ recipientRegistered: false, storageDepositYocto: 1_250n * 10n ** 18n }),
      ),
    );
    expect(p.map((t) => `${t.receiverId}:${t.actions[0]?.methodName}`)).toEqual([
      `${WRAP}:ft_transfer_call`,
      `${USDC}:storage_deposit`,
      `${USDC}:ft_transfer`,
    ]);
    // An unregistered recipient with no known deposit is refused, not guessed.
    expect(
      collateralDepositPayload(deposit({ fees: [fee] }), params({ recipientRegistered: false })).ok,
    ).toBe(false);
  });
});

describe("borrowPayload", () => {
  const borrow = (p: Partial<Parameters<typeof borrowPayload>[1]> = {}) => ({
    ...params(),
    extraDecimals: 0,
    ...p,
  });

  it("is Borrow followed by an amount-omitted Withdraw with exactly 1 yocto (public Gate 1 shape)", () => {
    expect(unwrap(borrowPayload(draft(), borrow()))).toEqual([
      {
        receiverId: LENDING,
        actions: [
          {
            methodName: "execute_with_pyth",
            args: {
              actions: [
                { Borrow: { token_id: REF, amount: "500000000000000000" } },
                { Withdraw: { token_id: REF } },
              ],
            },
            gas: OPENING_GAS,
            deposit: 1n,
          },
        ],
      },
    ]);
  });

  it("the Withdraw never carries amount or max_amount, in any build", () => {
    const p = unwrap(borrowPayload(draft({ amount: 12_345n }), borrow({ extraDecimals: 12 })));
    const list = (p[0]?.actions[0]?.args.actions ?? []) as { Withdraw?: Record<string, unknown> }[];
    const withdraw = list[1];
    expect(Object.keys(withdraw?.Withdraw ?? {})).toEqual(["token_id"]);
    expect(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(
      /max_amount/,
    );
  });

  it("converts atomic to Rhea internal units with the debt token's extra decimals", () => {
    const p = unwrap(
      borrowPayload(draft({ tokenId: USDC, amount: 37_500_000n }), borrow({ extraDecimals: 12 })),
    );
    const actions = p[0]?.actions[0]?.args.actions as { Borrow: { amount: string } }[];
    expect(actions[0]?.Borrow.amount).toBe("37500000000000000000");
  });

  it("refuses internal amounts above u128 and bad extra decimals", () => {
    expect(borrowPayload(draft({ amount: 2n ** 127n }), borrow({ extraDecimals: 1 })).ok).toBe(
      false,
    );
    for (const extraDecimals of [-1, 39, 1.5])
      expect(borrowPayload(draft(), borrow({ extraDecimals })).ok).toBe(false);
  });

  it("registers the debt token before the borrow so the tokens can be delivered", () => {
    const p = unwrap(
      borrowPayload(
        draft(),
        borrow({ registrations: [{ contractId: REF, depositYocto: 1_250n * 10n ** 18n }] }),
      ),
    );
    expect(p.map((t) => `${t.receiverId}:${t.actions[0]?.methodName}`)).toEqual([
      `${REF}:storage_deposit`,
      `${LENDING}:execute_with_pyth`,
    ]);
    // The lending contract is not a registration target for a borrow.
    expect(
      borrowPayload(draft(), borrow({ registrations: [{ contractId: LENDING, depositYocto: 1n }] }))
        .ok,
    ).toBe(false);
  });

  it("refuses a deposit draft, an unverified version and a zero amount", () => {
    expect(borrowPayload(draft({ action: "wallet_collateral_deposit" }), borrow()).ok).toBe(false);
    expect(borrowPayload(draft({ action: "repay" }), borrow()).ok).toBe(false);
    expect(borrowPayload(draft(), borrow({ lendingVersion: "0.16.2" })).ok).toBe(false);
    expect(borrowPayload(draft({ amount: 0n }), borrow()).ok).toBe(false);
  });

  it("two fee lines are refused by the shared fee helper", () => {
    const fee = { label: "Fee", amount: 1n, tokenId: USDC, recipientId: FEES, when: "once" };
    expect(borrowPayload(draft({ fees: [fee, fee] }), borrow()).ok).toBe(false);
  });
});
