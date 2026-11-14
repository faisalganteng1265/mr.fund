import { readFileSync } from "node:fs";
import type { OpenPositionContext } from "@mrfund/rhea";
import type { Card, FeeLine } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { baseSnapshot, NOW, USDC, usdcPrice, WNEAR } from "../../engine/test/helpers";
import { chatOutputViolations } from "../src/chat-output";
import { dispatch, sourcesOf, toToolMessage } from "../src/dispatch";
import { checkNumbers } from "../src/numbers";
import { buildPersonaPrompt } from "../src/persona";
import { TOOL_NAMES, type ToolContext, type ToolResult, toolDefinitions } from "../src/tools";

const LENDING = baseSnapshot().lendingId;
const FEES = "fees.testnet";
const pools = {
  borrowedShares: 10n ** 24n,
  borrowedBalance: 10n ** 24n,
  suppliedShares: 5n * 10n ** 24n,
  suppliedBalance: 5n * 10n ** 24n,
};
const opening = (over: Partial<OpenPositionContext> = {}): OpenPositionContext => ({
  snapshot: baseSnapshot(),
  collateralTokenId: WNEAR,
  debtTokenId: USDC,
  lendingVersion: "0.11.0",
  pools,
  accountBorrowedShares: 200n * 10n ** 18n,
  availableInternal: 10n ** 24n,
  oracleValidityMs: 60_000,
  walletCollateralBalance: 20n * 10n ** 24n,
  walletDebtBalance: 0n,
  registrations: {
    lending: { registered: true, minimumYocto: 10n ** 23n },
    collateralToken: { registered: true, minimumYocto: 1_250n * 10n ** 18n },
    debtToken: { registered: true, minimumYocto: 1_250n * 10n ** 18n },
  },
  blockHeight: 276_211_785,
  blockHash: "HASH",
  ...over,
});
const emptyAccount = () =>
  opening({
    snapshot: baseSnapshot({ collateral: [], borrowed: [] }),
    accountBorrowedShares: 0n,
  });
const FEE_LINE: FeeLine = {
  label: "Opening fee",
  amount: 10_000n,
  tokenId: USDC,
  recipientId: FEES,
  when: "Once, in the same signed batch.",
};
const ctx = (o: Partial<NonNullable<ToolContext["opening"]>> = {}, c = opening()): ToolContext => ({
  snapshot: c.snapshot,
  nowMs: NOW,
  newId: () => "card-1",
  opening: {
    context: c,
    fee: { kind: "none" },
    feeRecipientRegistered: true,
    defaultTargetBps: 15_000,
    ...o,
  },
});
const run = (name: string, args: unknown, c: ToolContext = ctx()) =>
  dispatch({ name, arguments: args }, c);
const okOf = (r: ToolResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.refusal)}`);
  return r;
};
const refusalOf = (r: ToolResult) => {
  if (r.ok) throw new Error("expected a refusal");
  return r.refusal;
};
const fact = (r: ToolResult, label: string) => okOf(r).facts.find((f) => f.label === label);
const action = (c: Card, i = 0) => c.payload[i]?.actions[0];

describe("quote_opening", () => {
  it("states the maximum additional borrow, target, health and APR from the engine", async () => {
    const r = await run("quote_opening", { target_health_percent: "120" });
    expect(fact(r, "maximum additional borrow")).toEqual({
      label: "maximum additional borrow",
      value: "37.5",
      unit: "USDC",
    });
    expect(fact(r, "target health")).toMatchObject({ value: "120", unit: "%" });
    expect(fact(r, "health factor now (percent)")).toMatchObject({ value: "142.5", unit: "%" });
    expect(fact(r, "borrow APR")).toMatchObject({ value: "21", unit: "%" });
    expect(okOf(r).text.bindingLimit).toBe("target_health");
    expect(okOf(r).card).toBeUndefined();
  });

  it("uses the configured default target when the user names none", async () => {
    const r = await run("quote_opening", {});
    expect(fact(r, "target health")).toMatchObject({ value: "150" });
  });

  it("an account with no collateral has a zero maximum and says why", async () => {
    const r = await run("quote_opening", {}, ctx({}, emptyAccount()));
    expect(fact(r, "maximum additional borrow")?.value).toBe("0");
    expect(okOf(r).text.bindingLimit).toBe("no_collateral");
    expect(okOf(r).notes.join(" ")).toMatch(/deposit/i);
  });

  it("refuses without an opening context", async () => {
    const { opening: _o, ...bare } = ctx();
    expect(refusalOf(await run("quote_opening", {}, bare as ToolContext)).code).toBe(
      "not_available",
    );
  });

  it.each([
    ["a target at the liquidation line", { target_health_percent: "100" }],
    ["a target below it", { target_health_percent: "99.99" }],
    ["a non-number target", { target_health_percent: "abc" }],
    ["a negative target", { target_health_percent: "-5" }],
    ["an absurd target", { target_health_percent: "100000" }],
    ["too many decimals", { target_health_percent: "150.123" }],
  ])("refuses %s", async (_n, args) => {
    expect(refusalOf(await run("quote_opening", args)).code).toBe("invalid_arguments");
  });

  it("an unavailable debt price is a typed refusal, never a guess", async () => {
    const snap = baseSnapshot();
    const { [USDC]: _p, ...prices } = snap.prices;
    const c = opening({ snapshot: { ...snap, prices } });
    expect(refusalOf(await run("quote_opening", {}, ctx({}, c))).code).toBe("missing_price");
  });

  it("a stale debt price is refused, and the oracle window is the stricter limit", async () => {
    const snap = baseSnapshot();
    const old = { ...usdcPrice, publishTimeMs: NOW - 90_000 };
    const c = opening({ snapshot: { ...snap, prices: { ...snap.prices, [USDC]: old } } });
    expect(
      okOf(await run("quote_opening", {}, ctx({}, { ...c, oracleValidityMs: 120_000 }))).ok,
    ).toBe(true);
    expect(refusalOf(await run("quote_opening", {}, ctx({}, c))).code).toBe("stale_price");
  });

  it("an account holding a second collateral or debt token is refused, not ignored", async () => {
    const snap = baseSnapshot({
      collateral: [
        { tokenId: WNEAR, internal: 100n * 10n ** 24n },
        { tokenId: "other.testnet", internal: 1n },
      ],
    });
    expect(
      refusalOf(await run("quote_opening", {}, ctx({}, opening({ snapshot: snap })))).code,
    ).toBe("invalid_input");
  });

  it.each(["lending_id", "receiver_id", "fee", "gas", "deposit", "payload", "amount", "token"])(
    "rejects an unexpected argument: %s",
    async (key) => {
      expect(refusalOf(await run("quote_opening", { [key]: "x" })).code).toBe("invalid_arguments");
    },
  );
});

describe("propose_opening: the borrow stage", () => {
  const borrow = (args: Record<string, unknown> = {}) =>
    run("propose_opening", {
      stage: "borrow",
      amount: "37.5",
      target_health_percent: "120",
      ...args,
    });

  it("builds a draft card with engine numbers and a Rhea-built payload", async () => {
    const r = okOf(await borrow());
    const card = r.card as Card;
    expect(card).toMatchObject({
      id: "card-1",
      action: "wallet_borrow",
      headline: "Borrow 37.5 USDC",
    });
    expect(action(card)).toMatchObject({ methodName: "execute_with_pyth", deposit: 1n });
    const actions = action(card)?.args.actions as {
      Borrow: { amount: string };
      Withdraw?: Record<string, unknown>;
    }[];
    expect(actions[0]?.Borrow.amount).toBe((37_500_000n * 10n ** 12n).toString());
    expect(Object.keys(actions[1]?.Withdraw ?? {})).toEqual(["token_id"]);
    expect(fact(r, "Health factor after")).toMatchObject({ value: "120", unit: "%" });
    expect(fact(r, "Debt after")).toMatchObject({ value: "237.5", unit: "USDC" });
    expect(r.text).toMatchObject({ card: "draft", headline: "Borrow 37.5 USDC" });
  });

  it("the model's tool message carries the card id and numbers but no payload bytes", async () => {
    const msg = toToolMessage(await borrow());
    expect(msg).toContain("card-1");
    for (const secret of [
      "execute_with_pyth",
      "ft_transfer",
      "receiverId",
      "gas",
      "Withdraw",
      LENDING,
      "msg",
    ])
      expect(msg).not.toContain(secret);
  });

  it("an amount above the maximum is refused with the reason", async () => {
    const f = refusalOf(await borrow({ amount: "37.500001" }));
    expect(f.code).toBe("invalid_amount");
    expect(f.message).toMatch(/exceeds the maximum/);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["not a number", "lots"],
    ["too many decimals", "1.1234567"],
    ["a JSON object", { v: 1 }],
  ])("refuses an amount that is %s", async (_n, amount) => {
    expect(["invalid_arguments", "invalid_amount"]).toContain(
      refusalOf(await borrow({ amount })).code,
    );
  });

  it("an unavailable USDC price blocks the card", async () => {
    const snap = baseSnapshot();
    const { [USDC]: _p, ...prices } = snap.prices;
    const c = ctx({}, opening({ snapshot: { ...snap, prices } }));
    expect(refusalOf(await run("propose_opening", { stage: "borrow", amount: "1" }, c)).code).toBe(
      "missing_price",
    );
  });

  it("a supplied balance that an amount-omitted withdraw would sweep is refused", async () => {
    const snap = baseSnapshot({ supplied: [{ tokenId: USDC, internal: 5n }] });
    const c = ctx({}, opening({ snapshot: snap }));
    expect(refusalOf(await run("propose_opening", { stage: "borrow", amount: "1" }, c)).code).toBe(
      "invalid_input",
    );
  });

  it("a missing debt-token registration is carried into the payload and the card", async () => {
    const c = ctx(
      {},
      opening({
        registrations: {
          ...opening().registrations,
          debtToken: { registered: false, minimumYocto: 1_250n * 10n ** 18n },
        },
      }),
    );
    const r = okOf(
      await run(
        "propose_opening",
        { stage: "borrow", amount: "1", target_health_percent: "120" },
        c,
      ),
    );
    const card = r.card as Card;
    expect(card.payload.map((t) => `${t.receiverId}:${t.actions[0]?.methodName}`)).toEqual([
      `${USDC}:storage_deposit`,
      `${LENDING}:execute_with_pyth`,
    ]);
    expect(card.numbers).toContainEqual({
      label: "USDC registration deposit",
      after: "0.00125",
      unit: "NEAR",
    });
    // The registration is for the connected account, taken from the trusted context.
    expect(action(card, 0)?.args).toEqual({ account_id: "alice.testnet", registration_only: true });
  });
});

describe("propose_opening: the deposit stage", () => {
  const deposit = (args: Record<string, unknown> = {}, c = ctx()) =>
    run("propose_opening", { stage: "deposit", amount: "10", ...args }, c);

  it("builds a deposit card whose payload is only IncreaseCollateral", async () => {
    const r = okOf(await deposit());
    const card = r.card as Card;
    expect(card).toMatchObject({
      action: "wallet_collateral_deposit",
      headline: "Deposit 10 wNEAR as collateral",
    });
    expect(card.payload).toHaveLength(1);
    expect(card.payload[0]?.receiverId).toBe(WNEAR);
    expect(action(card)?.args.msg).toBe(
      '{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":"wrap.testnet"}}]}}',
    );
    expect(fact(r, "Deposit after")).toMatchObject({ value: "10", unit: "wNEAR" });
  });

  it("works for an account with no position, and shows the borrowing power as conditional", async () => {
    const r = okOf(await deposit({}, ctx({}, emptyAccount())));
    expect(fact(r, "Borrowing power after it settles (conditional) after")).toBeDefined();
    expect(okOf(r).notes.join(" ")).toMatch(/conditional on this deposit settling/);
  });

  it("refuses more than the wallet holds", async () => {
    expect(refusalOf(await deposit({ amount: "20.000001" })).code).toBe("invalid_amount");
  });

  it("a missing Rhea registration becomes a bounded registration transaction first", async () => {
    const c = ctx(
      {},
      opening({
        registrations: {
          ...opening().registrations,
          lending: { registered: false, minimumYocto: 10n ** 23n },
        },
      }),
    );
    const card = okOf(await deposit({}, c)).card as Card;
    expect(card.payload.map((t) => `${t.receiverId}:${t.actions[0]?.methodName}`)).toEqual([
      `${LENDING}:storage_deposit`,
      `${WNEAR}:ft_transfer_call`,
    ]);
    expect(action(card)?.deposit).toBe(10n ** 23n);
    expect(action(card)?.args).toEqual({ account_id: "alice.testnet", registration_only: true });
  });
});

describe("propose_opening: arguments the model cannot choose", () => {
  it.each([
    ["no stage", { amount: "1" }],
    ["an unknown stage", { stage: "swap", amount: "1" }],
    ["both stages", { stage: ["deposit", "borrow"], amount: "1" }],
    ["no amount", { stage: "borrow" }],
    ["a stage of the wrong type", { stage: 1, amount: "1" }],
    ["a non-object", "borrow 1 USDC"],
  ])("refuses %s and asks for it instead of assuming", async (_n, args) => {
    const r = refusalOf(await run("propose_opening", args));
    expect(r.code).toBe("invalid_arguments");
    // A missing stage or amount is something to ask the user, not to guess.
    if (_n === "no amount") expect(r.message).toMatch(/ask the user/);
    if (_n === "no stage" || _n === "an unknown stage")
      expect(r.message).toMatch(/deposit, borrow/);
  });

  it.each([
    "lending_id",
    "lendingId",
    "receiver_id",
    "receiverId",
    "recipient",
    "fee",
    "fees",
    "gas",
    "deposit",
    "msg",
    "payload",
    "methodName",
    "signer",
    "account_id",
    "version",
    "pool",
  ])("rejects the override %s", async (key) => {
    expect(
      refusalOf(
        await run("propose_opening", { stage: "borrow", amount: "1", [key]: "evil.testnet" }),
      ).code,
    ).toBe("invalid_arguments");
  });

  it("only the stage's own token may be named: no other pair, no swapped roles", async () => {
    expect(
      refusalOf(await run("propose_opening", { stage: "borrow", amount: "1", token: "wNEAR" }))
        .code,
    ).toBe("unsupported_asset");
    expect(
      refusalOf(await run("propose_opening", { stage: "deposit", amount: "1", token: "USDC" }))
        .code,
    ).toBe("unsupported_asset");
    expect(
      refusalOf(
        await run("propose_opening", { stage: "borrow", amount: "1", token: "dai.testnet" }),
      ).code,
    ).toBe("unsupported_asset");
    // The right token, by symbol or id, in any case, is accepted.
    for (const token of ["USDC", "usdc", USDC])
      expect(
        okOf(
          await run("propose_opening", {
            stage: "borrow",
            amount: "1",
            token,
            target_health_percent: "120",
          }),
        ).card,
      ).toBeDefined();
  });

  it("the empty-position flow: deposit can be proposed, a borrow cannot", async () => {
    const empty = ctx({}, emptyAccount());
    expect(
      okOf(await run("propose_opening", { stage: "deposit", amount: "1" }, empty)).card,
    ).toBeDefined();
    expect(
      refusalOf(await run("propose_opening", { stage: "borrow", amount: "1" }, empty)).code,
    ).toBe("invalid_amount");
  });

  it("refuses without an opening context or a wallet", async () => {
    const { opening: _o, ...bare } = ctx();
    expect(
      refusalOf(await run("propose_opening", { stage: "borrow", amount: "1" }, bare as ToolContext))
        .code,
    ).toBe("not_available");
  });
});

describe("the opening fee policy is explicit", () => {
  const args = { stage: "borrow", amount: "1", target_health_percent: "120" };
  it("no policy means no card", async () => {
    const c = ctx();
    const { fee: _f, ...rest } = c.opening as NonNullable<ToolContext["opening"]>;
    const r = await run("propose_opening", args, { ...c, opening: rest as never });
    expect(refusalOf(r).code).toBe("fee_policy_missing");
  });
  it("an approved fee is carried into the card; a zero or unknown fee is refused", async () => {
    const card = okOf(
      await run("propose_opening", args, ctx({ fee: { kind: "fee", line: FEE_LINE } })),
    ).card as Card;
    expect(card.fees).toEqual([FEE_LINE]);
    expect(card.payload.at(-1)?.actions[0]?.methodName).toBe("ft_transfer");
    for (const fee of [{ kind: "fee", line: { ...FEE_LINE, amount: 0n } }, { kind: "free" }])
      expect(refusalOf(await run("propose_opening", args, ctx({ fee: fee as never }))).code).toBe(
        "invalid_input",
      );
  });
});

describe("numbers the model may quote come only from these tools", () => {
  it("an invented maximum or health fails the number guard; the real ones pass", async () => {
    const r = await run("quote_opening", { target_health_percent: "120" });
    const sources = sourcesOf(r);
    expect(checkNumbers("You can borrow up to 37.5 USDC at a 120% target.", sources)).toEqual({
      ok: true,
    });
    expect(checkNumbers("You can borrow up to 99 USDC.", sources)).toMatchObject({ ok: false });
    expect(checkNumbers("Your health would be 300%.", sources)).toMatchObject({ ok: false });
  });

  it("an invented liquidation line is refused as an unsourced threshold", async () => {
    expect(
      checkNumbers("Below 1.5 you could be liquidated.", sourcesOf(await run("quote_opening", {}))),
    ).toMatchObject({ ok: false });
  });

  it("a first borrow has no 'before' debt or health, and the sources stay checkable decimals", async () => {
    const first = opening({
      snapshot: baseSnapshot({ borrowed: [] }),
      accountBorrowedShares: 0n,
    });
    const r = okOf(
      await run(
        "propose_opening",
        { stage: "borrow", amount: "1", target_health_percent: "120" },
        ctx({}, first),
      ),
    );
    const sources = sourcesOf(r);
    for (const s of sources) expect(s.value, s.value).toMatch(/^-?\d+(\.\d+)?$/);
    const health = fact(r, "Health factor after")?.value ?? "";
    expect(checkNumbers(`The health factor would be ${health}%.`, sources)).toEqual({ ok: true });
    expect(okOf(r).notes.join(" ")).toMatch(/Health factor before: No debt/);
  });

  it("claims of having deposited or borrowed are execution claims and are refused", () => {
    for (const text of [
      "I deposited 10 wNEAR for you.",
      "I have borrowed 5 USDC for you.",
      "I can borrow 5 USDC for you.",
      "Saya sudah meminjam 5 USDC untukmu.",
      "Saya telah menyetor 10 wNEAR.",
      "Ya he depositado 10 wNEAR.",
    ])
      expect(chatOutputViolations(text), text).toContain("unsupported execution claim");
    for (const text of [
      "I cannot borrow for you; I can prepare a draft you approve in your wallet.",
      "I can prepare a draft to deposit 10 wNEAR.",
      "Saya tidak bisa meminjam untukmu.",
    ])
      expect(chatOutputViolations(text), text).toEqual([]);
  });
});

describe("registry and boundaries", () => {
  it("registers both tools with closed schemas", () => {
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(["quote_opening", "propose_opening"]));
    const defs = toolDefinitions();
    for (const name of ["quote_opening", "propose_opening"]) {
      const d = defs.find((x) => x.name === name);
      expect(d?.parameters.additionalProperties).toBe(false);
    }
    const p = defs.find((x) => x.name === "propose_opening");
    expect(p?.parameters.required).toEqual(["stage", "amount"]);
    const stage = (p?.parameters.properties as Record<string, { enum: string[] }> | undefined)
      ?.stage;
    expect(stage?.enum).toEqual(["deposit", "borrow"]);
    // No argument can name a contract, receiver, fee, gas or message.
    expect(Object.keys(p?.parameters.properties ?? {}).sort()).toEqual([
      "amount",
      "stage",
      "target_health_percent",
      "token",
    ]);
  });

  it("the persona tells the model to ask, quote first and never combine the stages", () => {
    const prompt = buildPersonaPrompt();
    expect(prompt).toMatch(/Opening a position/);
    expect(prompt).toMatch(/ask for a missing amount or token/);
    expect(prompt).toMatch(/Call quote_opening before saying how much can be borrowed/);
    expect(prompt).toMatch(/separate cards/);
  });

  it("no agent source can sign or send, including the new tools", () => {
    const src = readFileSync(new URL("../src/opening-tools.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/signAndSend|signingWallet|TransactionSigner|near-api-js|@hot-labs/);
  });

  it("an unexpected throw inside a tool is a typed refusal, never an exception", async () => {
    const c = ctx();
    const broken = {
      ...c,
      opening: { ...(c.opening as object), context: null },
    } as unknown as ToolContext;
    const r = await run("quote_opening", {}, broken);
    expect(r.ok).toBe(false);
  });
});

describe("the opening context is loaded lazily and only when a tool needs it", () => {
  const base = () => {
    const c = ctx();
    const { opening, ...rest } = c;
    return { rest, opening: opening as NonNullable<ToolContext["opening"]> };
  };

  it("never loads for any other tool, and loads for each opening tool call", async () => {
    const { rest, opening } = base();
    let loads = 0;
    const c: ToolContext = {
      ...rest,
      openingLoader: async () => {
        loads++;
        return opening;
      },
    };
    await dispatch({ name: "get_position", arguments: {} }, c);
    await dispatch({ name: "explain_term", arguments: { term: "collateral" } }, c);
    expect(loads).toBe(0);
    expect((await run("quote_opening", { target_health_percent: "120" }, c)).ok).toBe(true);
    expect(loads).toBe(1);
    expect(
      (
        await run(
          "propose_opening",
          { stage: "borrow", amount: "1", target_health_percent: "120" },
          c,
        )
      ).ok,
    ).toBe(true);
    expect(loads).toBe(2);
  });

  it("a loader that returns null or throws makes the tools unavailable, never a guess", async () => {
    const { rest } = base();
    for (const openingLoader of [
      async () => null,
      async () => {
        throw new Error("rpc down");
      },
    ]) {
      const c: ToolContext = { ...rest, openingLoader };
      expect(refusalOf(await run("quote_opening", {}, c)).code).toBe("not_available");
      expect(
        refusalOf(await run("propose_opening", { stage: "borrow", amount: "1" }, c)).code,
      ).toBe("not_available");
    }
  });

  it("an already-supplied opening context wins over the loader", async () => {
    const { opening } = base();
    let loads = 0;
    const c: ToolContext = {
      ...ctx(),
      opening,
      openingLoader: async () => {
        loads++;
        return null;
      },
    };
    expect((await run("quote_opening", {}, c)).ok).toBe(true);
    expect(loads).toBe(0);
  });
});
