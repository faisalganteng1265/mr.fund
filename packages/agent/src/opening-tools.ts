/**
 * Chat tools for opening a plain-wallet Rhea position (`add-chat-open-position` 5.1):
 * `quote_opening` (read-only limits) and `propose_opening` (one draft card per stage).
 *
 * Permission boundary: the model names a stage, an amount, optionally the stage's own token and a
 * target health, and nothing else; every other value (lending contract, version, account, pools,
 * liquidity, fees, registrations, receivers, gas, messages) comes from the server-supplied
 * `OpeningToolContext`, so no argument can redirect a transfer. Numbers come from the engine and
 * payloads from the Rhea builders; the payload lives only on `ToolResult.card` and never reaches
 * the model's tool message. This module imports no signer and no wallet code.
 *
 * One stage per card: a deposit, then (after the user approved it and it is observed) a separate
 * borrow card. A borrow is quoted from collateral Rhea already holds, so an account with none
 * gets a zero maximum and a refusal, never a quote against a deposit that has not landed.
 *
 * Does not guarantee: that Rhea accepts the action, exact delivery, or that the numbers hold at
 * signing; the browser re-reads and re-verifies before the wallet.
 */
import {
  assembleCard,
  borrowCardDraft,
  depositCardDraft,
  healthBps,
  maxBorrow,
  type OpeningFee,
  type OpenPositionInput,
} from "@mrfund/engine";
import {
  borrowPayload,
  collateralDepositPayload,
  type OpenPositionContext,
  type RegistrationDeposit,
} from "@mrfund/rhea";
import type { Card } from "@mrfund/shared";
import { fromAtomic } from "./numbers";
import {
  argsOf,
  dataAgeFact,
  engineRefusal,
  fact,
  invalid,
  parseAmount,
  refuse,
  resolveAsset,
} from "./tool-support";
import type { Fact, ToolContext, ToolResult } from "./tools";

/** Server-supplied inputs for the opening tools; none of it is a model argument. */
export interface OpeningToolContext {
  /** Block-pinned opening context for the connected account, read by the server. */
  context: OpenPositionContext;
  /** An approved fee or an approved none; absent means the stage cannot be proposed. */
  fee?: OpeningFee;
  /** Whether the fee recipient is registered on the fee token. */
  feeRecipientRegistered: boolean;
  /** The fee token's `storage_balance_bounds().min`, needed only for an unregistered recipient. */
  storageDepositYocto?: bigint;
  /** Target health in bps when the user names none (a preference, never a reason to borrow). */
  defaultTargetBps: number;
}

type Stage = "deposit" | "borrow";
const MAX_TARGET_PERCENT = 1000n;

function openingOf(tool: string, ctx: ToolContext): OpeningToolContext | ToolResult {
  if (!ctx.opening)
    return refuse(tool, "not_available", "Opening a position is not available for this session.");
  return ctx.opening;
}
const isRefusal = (v: OpeningToolContext | ToolResult): v is ToolResult => "ok" in v;

/** `target_health_percent` ("150", "150.5") to whole bps strictly above 100 %, or a message. */
function targetBps(raw: unknown, fallback: number): number | string {
  if (raw === undefined) return fallback;
  const parsed = parseAmount(raw, 2);
  if (typeof parsed === "string")
    return "target_health_percent must be a decimal percent such as 150 with at most two decimals";
  if (parsed <= 10_000n || parsed > MAX_TARGET_PERCENT * 100n)
    return `target_health_percent must be above 100 and at most ${MAX_TARGET_PERCENT}`;
  return Number(parsed);
}

function inputOf(o: OpeningToolContext, target: number): OpenPositionInput {
  const c = o.context;
  return {
    snapshot: c.snapshot,
    collateralTokenId: c.collateralTokenId,
    debtTokenId: c.debtTokenId,
    lendingVersion: c.lendingVersion,
    pools: c.pools,
    accountBorrowedShares: c.accountBorrowedShares,
    availableInternal: c.availableInternal,
    targetBps: target,
    oracleValidityMs: c.oracleValidityMs,
  };
}

const sum = (lines: { tokenId: string; internal: bigint }[], id: string) =>
  lines.reduce((s, l) => (l.tokenId === id ? s + l.internal : s), 0n);

export const quoteOpening = (args: Record<string, unknown>, ctx: ToolContext): ToolResult => {
  const tool = "quote_opening";
  const a = argsOf(args, ["target_health_percent"]);
  if (typeof a === "string") return invalid(tool, a);
  const o = openingOf(tool, ctx);
  if (isRefusal(o)) return o;
  const target = targetBps(a.target_health_percent, o.defaultTargetBps);
  if (typeof target === "string") return invalid(tool, target);
  const c = o.context;
  const debt = c.snapshot.assets[c.debtTokenId]?.token;
  const collateral = c.snapshot.assets[c.collateralTokenId]?.token;
  if (!debt || !collateral)
    return refuse(tool, "unsupported_asset", "The token pair is not supported here.");

  const m = maxBorrow(inputOf(o, target), ctx.nowMs);
  if (!m.ok) return engineRefusal(tool, m.error);
  const max = m.value;
  const facts: Fact[] = [
    fact("maximum additional borrow", fromAtomic(max.value.maxAtomic, debt.decimals, debt.symbol)),
    fact("target health", fromAtomic(BigInt(target), 2, "%")),
    fact(
      "collateral in Rhea",
      fromAtomic(
        sum(c.snapshot.collateral, c.collateralTokenId),
        collateral.decimals + collateral.extraDecimals,
        collateral.symbol,
      ),
    ),
    fact(
      "wallet balance of the collateral token",
      fromAtomic(c.walletCollateralBalance, collateral.decimals, collateral.symbol),
    ),
    fact(
      "borrow APR",
      fromAtomic(BigInt(c.snapshot.assets[c.debtTokenId]?.borrowAprBps ?? 0), 2, "%"),
    ),
  ];
  const text: Record<string, string> = { bindingLimit: max.value.bindingLimit };
  const now = healthBps(c.snapshot, ctx.nowMs);
  if (now.ok && now.value.value !== "no_debt") {
    facts.push(
      fact("health factor now", fromAtomic(BigInt(now.value.value), 4, null)),
      fact("health factor now (percent)", fromAtomic(BigInt(now.value.value), 2, "%")),
    );
  } else if (now.ok) text.health = "no_debt";
  facts.push(dataAgeFact(max.dataAgeMs));
  const notes = [...max.assumptions];
  if (max.value.bindingLimit === "no_collateral")
    notes.push(
      "No collateral is deposited in Rhea yet. Deposit collateral first; a borrow is only quoted from collateral Rhea already holds.",
    );
  return { ok: true, tool, facts, notes, text, dataAgeMs: max.dataAgeMs, scenario: false };
};

export const proposeOpening = (args: Record<string, unknown>, ctx: ToolContext): ToolResult => {
  const tool = "propose_opening";
  const a = argsOf(args, ["stage", "amount", "token", "target_health_percent"]);
  if (typeof a === "string") return invalid(tool, a);
  if (a.stage !== "deposit" && a.stage !== "borrow")
    return invalid(tool, "stage must be one of: deposit, borrow. Ask the user which one.");
  const stage: Stage = a.stage;
  if (a.amount === undefined)
    return invalid(tool, "amount is required: ask the user how much, do not assume one.");
  const o = openingOf(tool, ctx);
  if (isRefusal(o)) return o;
  if (!o.fee)
    return refuse(
      tool,
      "fee_policy_missing",
      "No approved opening fee policy is configured, so a card cannot be prepared.",
    );
  const target = targetBps(a.target_health_percent, o.defaultTargetBps);
  if (typeof target === "string") return invalid(tool, target);

  const c = o.context;
  const stageTokenId = stage === "deposit" ? c.collateralTokenId : c.debtTokenId;
  const asset = c.snapshot.assets[stageTokenId];
  if (!asset) return refuse(tool, "unsupported_asset", "The token pair is not supported here.");
  if (a.token !== undefined) {
    if (typeof a.token !== "string") return invalid(tool, "token must be a string");
    if (resolveAsset(c.snapshot, a.token)?.token.id !== stageTokenId)
      return refuse(
        tool,
        "unsupported_asset",
        `Only ${asset.token.symbol} can be used for a ${stage} here.`,
      );
  }
  const amount = parseAmount(a.amount, asset.token.decimals);
  if (typeof amount === "string") return invalid(tool, amount);
  if (amount <= 0n) return refuse(tool, "invalid_amount", "The amount must be greater than zero.");

  const regs: RegistrationDeposit[] = [];
  const storage: { label: string; depositYocto: bigint }[] = [];
  if (stage === "deposit" && !c.registrations.lending.registered) {
    regs.push({
      contractId: c.snapshot.lendingId,
      depositYocto: c.registrations.lending.minimumYocto,
    });
    storage.push({
      label: "Rhea registration",
      depositYocto: c.registrations.lending.minimumYocto,
    });
  }
  if (stage === "borrow" && !c.registrations.debtToken.registered) {
    regs.push({ contractId: c.debtTokenId, depositYocto: c.registrations.debtToken.minimumYocto });
    storage.push({
      label: `${asset.token.symbol} registration`,
      depositYocto: c.registrations.debtToken.minimumYocto,
    });
  }
  const input = inputOf(o, target);
  const draft =
    stage === "deposit"
      ? depositCardDraft(input, amount, c.walletCollateralBalance, o.fee, ctx.nowMs, { storage })
      : borrowCardDraft(input, amount, o.fee, ctx.nowMs, { storage });
  if (!draft.ok) return engineRefusal(tool, draft.error);
  const d = draft.value;

  const params = {
    lendingId: c.snapshot.lendingId,
    lendingVersion: c.lendingVersion,
    accountId: c.snapshot.accountId,
    registrations: regs,
    recipientRegistered: o.feeRecipientRegistered,
    ...(o.storageDepositYocto === undefined ? {} : { storageDepositYocto: o.storageDepositYocto }),
  };
  const payload =
    stage === "deposit"
      ? collateralDepositPayload(d, params)
      : borrowPayload(d, { ...params, extraDecimals: asset.token.extraDecimals });
  if (!payload.ok) return engineRefusal(tool, payload.error);

  // Facts feed the number checker, which accepts exact decimals only. A state such as "No debt"
  // (a first borrow has no 'before' health) is prose, so it goes to the notes instead.
  const facts: Fact[] = [];
  const stateNotes: string[] = [];
  const decimal = /^-?\d+(\.\d+)?$/;
  for (const n of d.numbers) {
    for (const [when, value] of [
      ["before", n.before],
      ["after", n.after],
    ] as const) {
      if (value === undefined) continue;
      if (decimal.test(value)) facts.push({ label: `${n.label} ${when}`, value, unit: n.unit });
      else stateNotes.push(`${n.label} ${when}: ${value}.`);
    }
  }
  const feeAsset = c.snapshot.assets[d.fees[0]?.tokenId ?? ""]?.token;
  for (const f of d.fees)
    facts.push(
      fact("opening fee", fromAtomic(f.amount, feeAsset?.decimals ?? 0, feeAsset?.symbol ?? null)),
    );
  facts.push(dataAgeFact(d.dataAgeMs));
  const card: Card = assembleCard(d, {
    id: ctx.newId ? ctx.newId() : crypto.randomUUID(),
    reason: "",
    payload: payload.value,
  });
  return {
    ok: true,
    tool,
    facts,
    notes: [
      "A draft card is shown to the user. Nothing is signed or sent until they approve it in their wallet.",
      stage === "deposit"
        ? "Borrowing is a separate card, offered only after this deposit is approved and observed on chain."
        : "This borrow was quoted from collateral Rhea already holds.",
      ...stateNotes,
      ...d.assumptions,
    ],
    text: { card: "draft", headline: d.headline, risks: d.risks.join(" "), stage },
    dataAgeMs: d.dataAgeMs,
    scenario: false,
    card,
  };
};
