import { assembleCard, repayCard } from "@mrfund/engine";
import { type OutcomeReader, type RheaClient, repayPayload } from "@mrfund/rhea";
import { type Card, err, ok, type PositionSnapshot } from "@mrfund/shared";
import { describe, expect, it, vi } from "vitest";
import { baseSnapshot, NOW, USDC } from "../../../packages/engine/test/helpers";
import { readExecutionConfig } from "../src/execution/config";
import { cardMatchesPosition, createLiveRepay, parseLendingVersion } from "../src/execution/live";
import { createTransactionSigner } from "../src/execution/signer";
import { decodeWireCard } from "../src/execution/wire";

const ALICE = "alice.testnet";
const FEES = "fees.testnet";
const LENDING = baseSnapshot().lendingId;
const TOKEN = { id: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12 };
const HASH = "7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv";

/** A real engine card with a builder payload, as the chat route streams it (bigint → string). */
function wireCard(fee = 250_000n, registered = true): unknown {
  const draft = repayCard(
    baseSnapshot(),
    { tokenId: USDC, amount: 50_000_000n, walletBalance: 1_000_000_000n },
    { tokenId: USDC, recipientId: FEES, activationFee: 0n, actionFee: 0n, executionFee: fee },
    NOW,
  );
  if (!draft.ok) throw new Error(draft.error.kind);
  const payload = repayPayload(draft.value, {
    lendingId: LENDING,
    lendingVersion: "0.16.2",
    extraDecimals: 12,
    recipientRegistered: registered,
    storageDepositYocto: 1_250_000_000_000_000_000_000n,
  });
  if (!payload.ok) throw new Error(payload.error.kind);
  const card = assembleCard(draft.value, { id: "card-1", reason: "", payload: payload.value });
  return JSON.parse(
    JSON.stringify(card, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
const decoded = (w = wireCard()) => {
  const c = decodeWireCard(w);
  if (!c) throw new Error("fixture");
  return c;
};

describe("decodeWireCard", () => {
  it("restores bigint gas, deposit and fee amounts exactly", () => {
    const c = decoded();
    expect(c.payload.every((t) => t.actions.every((a) => typeof a.gas === "bigint"))).toBe(true);
    expect(c.payload[0]?.actions[0]?.deposit).toBe(1n);
    expect(c.fees[0]?.amount).toBe(250_000n);
  });
  it.each([
    [
      "a fractional deposit",
      (w: Card) => ((w.payload[0]?.actions[0] as { deposit: unknown }).deposit = "1.5"),
    ],
    ["a negative gas", (w: Card) => ((w.payload[0]?.actions[0] as { gas: unknown }).gas = "-1")],
    ["a numeric fee", (w: Card) => ((w.fees[0] as { amount: unknown }).amount = 250000)],
    ["a missing payload", (w: Card) => ((w as { payload: unknown }).payload = undefined)],
  ])("refuses %s", (_name, mutate) => {
    const w = wireCard() as Card;
    mutate(w);
    expect(decodeWireCard(w)).toBeNull();
  });
});

describe("cardMatchesPosition", () => {
  const card = decoded();
  const debt = (atomic: bigint) =>
    baseSnapshot({ borrowed: [{ tokenId: USDC, internal: atomic * 10n ** 12n }] });
  it("accepts the snapshot the card came from and small accrued interest", () => {
    expect(cardMatchesPosition(card, baseSnapshot(), TOKEN, NOW)).toBe(true);
    expect(cardMatchesPosition(card, debt(200_100_000n), TOKEN, NOW)).toBe(true);
  });
  it.each([
    ["debt repaid elsewhere", debt(199_999_999n)],
    ["debt grew beyond interest", debt(200_300_000n)],
    [
      "health moved (collateral halved)",
      baseSnapshot({ collateral: [{ tokenId: "wrap.testnet", internal: 50n * 10n ** 24n }] }),
    ],
  ])("refuses %s", (_name, fresh) => {
    expect(cardMatchesPosition(card, fresh, TOKEN, NOW)).toBe(false);
  });
  it("only known versions", () => {
    expect(parseLendingVersion("0.16.2")).toBe("0.16.2");
    expect(parseLendingVersion("0.17.0")).toBeNull();
  });
});

function setup(
  over: {
    method?: "near-auth" | "near-connect";
    version?: unknown;
    wallet?: () => Promise<unknown>;
    reads?: PositionSnapshot[];
    config?: Parameters<typeof readExecutionConfig>[0];
  } = {},
) {
  const sign = vi.fn(
    over.wallet ??
      (async () => [
        { transaction: { hash: HASH, signer_id: ALICE, receiver_id: USDC } },
        {
          transaction: {
            hash: "8gWa7bJDPYoA9WaN7va6kaJ7pVyZz2cKxcW4bE2Fp3Hw",
            signer_id: ALICE,
            receiver_id: USDC,
          },
        },
      ]),
  );
  const rhea: RheaClient = {
    view: async (_id, method) =>
      method === "get_version"
        ? ok({ data: over.version ?? "0.16.2", blockHeight: 1, blockHash: "b" })
        : err({ kind: "bad_response", detail: "unexpected" }),
  };
  const reads = over.reads ?? [];
  const reader: OutcomeReader = {
    read: async () => err({ kind: "rpc_unavailable", detail: "not indexed yet" }),
  };
  const store = createLiveRepay({
    accountId: ALICE,
    network: "testnet",
    config: readExecutionConfig(
      over.config ?? { network: "testnet", lendingId: LENDING, feeRecipientId: FEES },
    ),
    rhea,
    reader,
    signer: createTransactionSigner(
      { method: over.method ?? "near-connect", accountId: ALICE, network: "testnet" },
      async () => ({ signAndSendTransactions: sign }),
    ),
    readPosition: async () => ok(reads.shift() ?? baseSnapshot()),
    now: () => NOW,
  });
  return { store, sign };
}
const signal = () => new AbortController().signal;

describe("live repay execution", () => {
  it("NEAR Auth: Execute is blocked with the reason and no wallet is reachable", async () => {
    const { store, sign } = setup({ method: "near-auth" });
    await store.prepare(decoded());
    expect(store.getSnapshot()).toMatchObject({ phase: "blocked", reason: /cannot sign/ });
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing configuration",
      { config: { network: "testnet", lendingId: LENDING } },
      /FEE_RECIPIENT/,
    ],
    ["an unknown lending version", { version: "0.99.0" }, /version/],
    [
      "a position that changed since the card",
      { reads: [baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 10n ** 18n }] })] },
      /changed/,
    ],
    [
      "a fee recipient other than configured",
      { config: { network: "testnet", lendingId: LENDING, feeRecipientId: "other.testnet" } },
      /fee recipient/,
    ],
  ])("blocks %s before any wallet prompt", async (_name, over, reason) => {
    const { store, sign } = setup(over as Parameters<typeof setup>[0]);
    await store.prepare(decoded());
    const v = store.getSnapshot();
    expect(v.phase).toBe("blocked");
    if (v.phase === "blocked") expect(v.reason).toMatch(reason);
    expect(sign).not.toHaveBeenCalled();
  });

  it("shows amount, fee with recipient, network and account before the wallet", async () => {
    const { store, sign } = setup();
    await store.prepare(decoded());
    expect(store.getSnapshot()).toEqual({
      phase: "confirm",
      cardId: "card-1",
      confirmation: {
        amount: "50 USDC",
        tokenId: USDC,
        fee: { amount: "0.25 USDC", recipientId: FEES },
        registrationNear: null,
        lendingId: LENDING,
        network: "testnet",
        accountId: ALICE,
      },
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("asks the wallet once, then shows a pending receipt with Check again and no link", async () => {
    const { store, sign } = setup();
    const card = decoded();
    await store.prepare(card);
    await Promise.all([store.confirm(card, signal()), store.confirm(card, signal())]);
    expect(sign).toHaveBeenCalledOnce();
    const v = store.getSnapshot();
    expect(v).toMatchObject({
      phase: "result",
      result: { kind: "receipt", receipt: { status: "submitted" } },
    });
    await store.check("card-1", signal());
    expect(store.getSnapshot()).toMatchObject({ result: { receipt: { status: "submitted" } } });
    // The card is never executable again (E3).
    await store.prepare(card);
    expect(store.getSnapshot()).toMatchObject({ phase: "blocked", reason: /already submitted/ });
  });

  it("a wallet rejection with unchanged debt says nothing was sent, never confirmed", async () => {
    const { store } = setup({
      wallet: async () => {
        throw new Error("User rejected");
      },
    });
    const card = decoded();
    await store.prepare(card);
    await store.confirm(card, signal());
    expect(store.getSnapshot()).toMatchObject({
      phase: "result",
      result: { kind: "nothing_observed" },
    });
  });

  it("a wallet error with a changed debt is an observed change, not a confirmation", async () => {
    const after = baseSnapshot({ borrowed: [{ tokenId: USDC, internal: 150n * 10n ** 18n }] });
    const { store } = setup({
      wallet: async () => {
        throw new Error("timeout");
      },
      reads: [baseSnapshot(), baseSnapshot(), after],
    });
    const card = decoded();
    await store.prepare(card);
    await store.confirm(card, signal());
    expect(store.getSnapshot()).toMatchObject({
      result: { kind: "observed_change", debtAfterInternal: 150n * 10n ** 18n },
    });
  });
});
