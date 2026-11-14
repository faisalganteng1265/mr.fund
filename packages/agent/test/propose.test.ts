import type { FeeSchedule } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { dispatch, sourcesOf, toToolMessage } from "../src/dispatch";
import { checkNumbers } from "../src/numbers";
import type { ProposalContext, ToolContext, ToolResult } from "../src/tools";
import { baseSnapshot, NOW, USDC } from "./fixture";

const USDC_1 = 1_000_000n;
const FEES: FeeSchedule = {
  tokenId: USDC,
  recipientId: "fees.testnet",
  activationFee: 0n,
  actionFee: 0n,
  executionFee: 100_000n,
};
const proposal = (over: Partial<ProposalContext> = {}): ProposalContext => ({
  walletBalances: { [USDC]: 1_000n * USDC_1 },
  fees: FEES,
  lendingId: "contract.1689937928.burrow.testnet",
  lendingVersion: "0.11.0",
  feeRecipientRegistered: true,
  ...over,
});
const ctx = (
  over: Partial<ProposalContext> = {},
  extra: Partial<ToolContext> = {},
): ToolContext => ({
  snapshot: baseSnapshot(),
  nowMs: NOW,
  proposal: proposal(over),
  newId: () => "card-1",
  ...extra,
});
const propose = async (args: unknown, c: ToolContext = ctx()) =>
  await dispatch({ name: "propose_card", arguments: args }, c);

function ok(r: ToolResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.refusal.code}: ${r.refusal.message}`);
  return r;
}
const fact = (r: ToolResult, label: string) => ok(r).facts.find((f) => f.label === label);
const repayResult = await propose({ action: "repay", amount: "50" });

describe("propose_card (repay)", () => {
  const r = repayResult;

  it("returns the engine's before and after numbers as facts", async () => {
    expect(fact(r, "Debt before")).toEqual({ label: "Debt before", value: "200", unit: "USDC" });
    expect(fact(r, "Debt after")).toEqual({ label: "Debt after", value: "150", unit: "USDC" });
    expect(fact(r, "Health factor before")).toEqual({
      label: "Health factor before",
      value: "142.5",
      unit: "%",
    });
    expect(fact(r, "Health factor after")?.value).toBe("190");
    expect(fact(r, "Annual interest cost after")?.value).toBe("31.5");
    expect(fact(r, "repay amount")).toEqual({ label: "repay amount", value: "50", unit: "USDC" });
    expect(fact(r, "execution fee")).toEqual({
      label: "execution fee",
      value: "0.1",
      unit: "USDC",
    });
    expect(fact(r, "data age")?.unit).toBe("s");
  });

  it("builds a draft card with the builder's payload and no reason yet", async () => {
    const card = ok(r).card;
    expect(card?.id).toBe("card-1");
    expect(card?.action).toBe("repay");
    expect(card?.reason).toBe("");
    expect(card?.headline).toBe("Repay 50 USDC");
    const repay = card?.payload[0]?.actions[0];
    expect(card?.payload[0]?.receiverId).toBe(USDC);
    expect(repay?.methodName).toBe("ft_transfer_call");
    expect(repay?.args).toEqual({
      receiver_id: "contract.1689937928.burrow.testnet",
      amount: "50000000",
      msg: '{"Execute":{"actions":[{"Repay":{"token_id":"usdc.fakes.testnet","max_amount":"50000000000000000000"}}]}}',
    });
    expect(repay?.deposit).toBe(1n);
    expect(card?.payload[1]?.actions[0]?.methodName).toBe("ft_transfer");
  });

  it("tells the model what the card is, including risks, and that nothing was signed", async () => {
    expect(ok(r).text.card).toBe("draft");
    expect(ok(r).text.risks).toMatch(/Rates change/);
    expect(ok(r).notes.join(" ")).toMatch(/Nothing is signed or sent/);
    expect(ok(r).scenario).toBe(false);
  });

  it("is a draft, not a signed or sent transaction", async () => {
    expect(ok(r).card?.receipt).toBeUndefined();
  });
});

describe("propose_card amounts", () => {
  it("defaults to the whole debt", async () => {
    const r = await propose({ action: "repay" });
    expect(fact(r, "repay amount")?.value).toBe("200");
  });

  it("caps at the wallet balance and says which limit applied", async () => {
    const r = await propose(
      { action: "repay", amount: "150" },
      ctx({ walletBalances: { [USDC]: 30n * USDC_1 } }),
    );
    expect(fact(r, "repay amount")?.value).toBe("29.9");
    expect(ok(r).text.cappedBy).toBe("wallet");
  });

  it("accepts a numeric amount and a token symbol", async () => {
    const r = await propose({ action: "repay", amount: 50, token: "usdc" });
    expect(fact(r, "repay amount")?.value).toBe("50");
  });

  it.each([["abc"], ["-1"], ["0"], ["1.1234567"], [""], [null]])(
    "refuses amount %j",
    async (amount) => {
      const r = await propose({ action: "repay", amount });
      expect(r.ok).toBe(false);
    },
  );
});

describe("propose_card refusals", () => {
  const code = (r: ToolResult) => (r.ok ? "ok" : r.refusal.code);

  it("needs a connected wallet context", async () => {
    const { proposal: _p, ...noWallet } = ctx();
    expect(code(await propose({ action: "repay" }, noWallet))).toBe("not_available");
  });

  it.each([
    [undefined],
    [{}],
    [{ action: "guardian_activate" }],
    [{ action: "send" }],
    [{ action: "repay", payload: [] }],
    [{ action: "repay", recipient: "evil.near" }],
    ["repay"],
  ])("refuses arguments %j", async (args) => {
    expect(code(await propose(args))).toBe("invalid_arguments");
  });

  it("refuses when the wallet holds none of the token", async () => {
    expect(code(await propose({ action: "repay" }, ctx({ walletBalances: {} })))).toBe(
      "invalid_amount",
    );
  });

  it("refuses when there is no debt", async () => {
    const s = baseSnapshot({ borrowed: [] });
    expect(code(await propose({ action: "repay" }, ctx({}, { snapshot: s })))).toBe("no_debt");
  });

  it("refuses stale data instead of building a card", async () => {
    expect(code(await propose({ action: "repay" }, ctx({}, { nowMs: NOW + 600_000 })))).toBe(
      "stale_snapshot",
    );
  });

  it("refuses an unregistered fee recipient with no deposit amount", async () => {
    expect(code(await propose({ action: "repay" }, ctx({ feeRecipientRegistered: false })))).toBe(
      "invalid_input",
    );
  });

  it("registers the recipient first when the deposit amount is known", async () => {
    const r = await propose(
      { action: "repay", amount: "50" },
      ctx({ feeRecipientRegistered: false, storageDepositYocto: 1_250_000_000_000_000_000_000n }),
    );
    expect(ok(r).card?.payload.map((t) => t.actions[0]?.methodName)).toEqual([
      "ft_transfer_call",
      "storage_deposit",
      "ft_transfer",
    ]);
  });

  it("refuses a fee token the position does not describe", async () => {
    const bad = { ...FEES, tokenId: "mystery.testnet" };
    expect(code(await propose({ action: "repay", amount: "50" }, ctx({ fees: bad })))).toBe(
      "invalid_input",
    );
  });
});

describe("propose_card and the model", () => {
  const r = repayResult;

  it("keeps payload bytes out of the tool message but names the card", async () => {
    const msg = toToolMessage(r);
    const parsed = JSON.parse(msg);
    expect(parsed.cardId).toBe("card-1");
    expect(parsed.card).toBeUndefined();
    expect(msg).not.toMatch(/OnlyRepay|ft_transfer|gas|deposit/);
  });

  it("feeds the number checker: card numbers pass, invented ones fail", async () => {
    const good = "Repaying 50 USDC lifts your health from 142.5% to 190%, and the fee is 0.1 USDC.";
    expect(checkNumbers(good, sourcesOf(r)).ok).toBe(true);
    expect(checkNumbers("That lifts your health to 210%.", sourcesOf(r)).ok).toBe(false);
  });

  it("generates an id when none is injected", async () => {
    const c = ctx();
    const { newId: _n, ...rest } = c;
    const out = await propose({ action: "repay", amount: "50" }, rest);
    expect(ok(out).card?.id.length).toBeGreaterThan(8);
  });
});
