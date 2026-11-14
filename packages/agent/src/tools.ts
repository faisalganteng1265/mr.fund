/**
 * Tool registry (BUILD-PLAN P3.1, ARCHITECTURE "Tool registry").
 *
 * Every tool is a read: it wraps one engine function and returns exact facts
 * (decimal strings with units), assumptions and the data age. No tool signs,
 * sends, changes a policy or calls the watcher; the LLM's text never becomes
 * payload bytes. Facts are also the source list for the number checker, so a
 * number can appear in a reply only if it is a fact here.
 *
 * Implemented now: get_position, compare_repay_vs_yield, what_if_price,
 * propose_card (repay, wallet loan), explain_term, guardian_status and
 * guardian_history. Guardian owner cards remain conditional on provisioning ABI.
 *
 * Does not guarantee: that a snapshot is fresh. The caller supplies it; the
 * engine refuses stale prices and the tool passes the refusal on.
 */

import {
  assembleCard,
  healthBps,
  LIQUIDATION_LINE_BPS,
  liquidationPrice,
  outstandingDebtAtomic,
  repayCard,
  repayVsYield,
  whatIfPrice,
} from "@mrfund/engine";
import { repayPayload } from "@mrfund/rhea";
import {
  type AssetState,
  type Atomic,
  type Card,
  type FeeSchedule,
  type PositionSnapshot,
  type Price,
  toAtomic,
  usdPerWholeToken,
} from "@mrfund/shared";
import { type GuardianToolContext, guardianTool, proposeGuardianControl } from "./guardian-tools";
import { fromAtomic, type SourceNumber } from "./numbers";
import { type OpeningToolContext, proposeOpening, quoteOpening } from "./opening-tools";
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

export interface Fact extends SourceNumber {
  readonly label: string;
}

export type ToolResult =
  | {
      ok: true;
      tool: string;
      facts: Fact[];
      notes: string[];
      /** Non-numeric conclusions, such as the winner of a comparison. */
      text: Record<string, string>;
      dataAgeMs: number | null;
      /** True for what-if results: a scenario, never a forecast. */
      scenario: boolean;
      /**
       * A draft card for the UI (`propose_card`). Never serialized into the tool message: the
       * model sees only its id and numbers, never payload bytes.
       */
      card?: Card;
    }
  | { ok: false; tool: string; refusal: { code: string; message: string } };

/** What `propose_card` needs from the connected wallet and the fee configuration. */
export interface ProposalContext {
  /** Wallet balances in token atomic units, by token id. */
  walletBalances: Record<string, Atomic>;
  fees: FeeSchedule;
  /** The Rhea lending contract that receives the repay. */
  lendingId: string;
  /** Read from the configured lending contract; no default or LLM override. */
  lendingVersion: string;
  /** Whether the fee recipient is registered on the fee token. */
  feeRecipientRegistered: boolean;
  /** The fee token's `storage_balance_bounds().min`, needed only if the recipient is unregistered. */
  storageDepositYocto?: bigint;
}

export interface ToolContext {
  snapshot: PositionSnapshot;
  nowMs: number;
  /** Absent when no wallet is connected; `propose_card` then refuses. */
  proposal?: ProposalContext;
  /** Card id source; defaults to a random UUID. */
  newId?: () => string;
  /** Server-selected Guardian target and public-read dependencies; never model arguments. */
  guardian?: GuardianToolContext;
  /** Server-read opening inputs for the plain-wallet deposit and borrow tools; never model arguments. */
  opening?: OpeningToolContext;
  /**
   * Reads the opening inputs on demand (an RPC round trip), so a chat turn that never calls an
   * opening tool pays nothing. Returns null when opening is not configured for the session.
   */
  openingLoader?: () => Promise<OpeningToolContext | null>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

type Runner = (args: Record<string, unknown>, ctx: ToolContext) => ToolResult | Promise<ToolResult>;

// ---------------------------------------------------------------- helpers

function signedPercentFromBps(bps: number): SourceNumber {
  const p = fromAtomic(BigInt(Math.abs(bps)), 2, "%");
  return bps < 0 ? { value: `-${p.value}`, unit: "%" } : p;
}

const percentOfBps = (bps: number) => fromAtomic(BigInt(bps), 2, "%");

/** USD per whole token, exact. */
const usdPerToken = (price: Price, tokenDecimals: number): SourceNumber => ({
  value: usdPerWholeToken(price, tokenDecimals),
  unit: "USD",
});

function healthFacts(prefix: string, bps: number): Fact[] {
  const b = BigInt(bps);
  return [
    fact(`${prefix}health factor`, fromAtomic(b, 4, null)),
    fact(`${prefix}health factor (percent)`, fromAtomic(b, 2, "%")),
  ];
}

// ------------------------------------------------------------------ tools

const getPosition: Runner = (args, { snapshot: s, nowMs }) => {
  const tool = "get_position";
  const bad = argsOf(args, []);
  if (typeof bad === "string") return invalid(tool, bad);

  const h = healthBps(s, nowMs);
  if (!h.ok) return engineRefusal(tool, h.error);

  const facts: Fact[] = [];
  const notes = [
    ...h.value.assumptions,
    "Rates are the protocol-reported APR, not converted APY; supply rounds down and borrow rounds up to whole basis points.",
  ];
  const text: Record<string, string> = {};
  const seen = new Set<string>();

  if (h.value.value === "no_debt") {
    text.health = "no debt";
    notes.push("There is no debt, so there is no health factor.");
  } else {
    facts.push(...healthFacts("", h.value.value));
  }

  const describe = (tokenId: string) => {
    const a = s.assets[tokenId];
    if (!a || seen.has(tokenId)) return;
    seen.add(tokenId);
    const price = s.prices[tokenId];
    if (price) facts.push(fact(`${a.token.symbol} price`, usdPerToken(price, a.token.decimals)));
    facts.push(fact(`${a.token.symbol} supply rate`, percentOfBps(a.supplyAprBps)));
    facts.push(fact(`${a.token.symbol} borrow rate`, percentOfBps(a.borrowAprBps)));
  };

  for (const b of s.collateral) {
    const a = s.assets[b.tokenId];
    if (!a || b.internal <= 0n) continue;
    facts.push(
      fact(
        `${a.token.symbol} collateral`,
        fromAtomic(toAtomic(b.internal, a.token.extraDecimals), a.token.decimals, a.token.symbol),
      ),
    );
    describe(b.tokenId);
    const lp = liquidationPrice(s, b.tokenId, nowMs);
    if (lp.ok) {
      if (lp.value.value.multiplier > 0n) {
        facts.push(
          fact(
            `${a.token.symbol} liquidation price`,
            usdPerToken(lp.value.value, a.token.decimals),
          ),
        );
      } else {
        notes.push(
          `Other collateral already covers the debt, so ${a.token.symbol} has no liquidation price.`,
        );
      }
    }
  }
  for (const b of s.supplied) {
    const a = s.assets[b.tokenId];
    if (!a || b.internal <= 0n) continue;
    facts.push(
      fact(
        `${a.token.symbol} supplied`,
        fromAtomic(toAtomic(b.internal, a.token.extraDecimals), a.token.decimals, a.token.symbol),
      ),
    );
    describe(b.tokenId);
  }
  for (const b of s.borrowed) {
    const a = s.assets[b.tokenId];
    if (!a || b.internal <= 0n) continue;
    facts.push(
      fact(
        `${a.token.symbol} debt`,
        fromAtomic(outstandingDebtAtomic(s, b.tokenId), a.token.decimals, a.token.symbol),
      ),
    );
    describe(b.tokenId);
  }

  facts.push(dataAgeFact(h.value.dataAgeMs));
  return { ok: true, tool, facts, notes, text, dataAgeMs: h.value.dataAgeMs, scenario: false };
};

const MAX_HORIZON_DAYS = 3650;

const compareRepayVsYield: Runner = (args, { snapshot: s, nowMs }) => {
  const tool = "compare_repay_vs_yield";
  const a = argsOf(args, ["amount", "token", "horizonDays"]);
  if (typeof a === "string") return invalid(tool, a);

  let asset: AssetState | undefined;
  if (a.token !== undefined) {
    if (typeof a.token !== "string") return invalid(tool, "token must be a string");
    asset = resolveAsset(s, a.token);
    if (!asset) return refuse(tool, "unsupported_asset", `${a.token} is not supported here.`);
  } else {
    const first = s.borrowed.find((b) => b.internal > 0n);
    asset = first && s.assets[first.tokenId];
    if (!asset) return refuse(tool, "no_debt", "There is no debt to repay.");
  }
  const tokenId = asset.token.id;

  let horizonDays = 365;
  if (a.horizonDays !== undefined) {
    const d = a.horizonDays;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > MAX_HORIZON_DAYS) {
      return invalid(tool, "horizonDays must be a whole number of days within the supported range");
    }
    horizonDays = d;
  }

  let amount: Atomic;
  if (a.amount === undefined) {
    amount = outstandingDebtAtomic(s, tokenId);
  } else {
    const parsed = parseAmount(a.amount, asset.token.decimals);
    if (typeof parsed === "string") return invalid(tool, parsed);
    amount = parsed;
  }

  const r = repayVsYield(
    s,
    { amount, tokenId, yieldAprBps: asset.supplyAprBps, horizonDays },
    nowMs,
  );
  if (!r.ok) return engineRefusal(tool, r.error);

  const { symbol, decimals } = asset.token;
  const v = r.value.value;
  return {
    ok: true,
    tool,
    facts: [
      fact("amount compared", fromAtomic(v.amountUsed, decimals, symbol)),
      fact("repaying saves", fromAtomic(v.repaySaves, decimals, symbol)),
      fact("yield earns", fromAtomic(v.yieldEarns, decimals, symbol)),
      fact(`${symbol} borrow rate`, percentOfBps(asset.borrowAprBps)),
      fact(`${symbol} supply rate`, percentOfBps(asset.supplyAprBps)),
      fact("horizon", { value: String(horizonDays), unit: "days" }),
      dataAgeFact(r.value.dataAgeMs),
    ],
    notes: r.value.assumptions,
    text: { winner: v.winner },
    dataAgeMs: r.value.dataAgeMs,
    scenario: false,
  };
};

const MAX_SHOCKS = 8;

const whatIf: Runner = (args, { snapshot: s, nowMs }) => {
  const tool = "what_if_price";
  const a = argsOf(args, ["shocks"]);
  if (typeof a === "string") return invalid(tool, a);
  const raw = a.shocks;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SHOCKS) {
    return invalid(tool, `shocks must be a list of 1 to ${MAX_SHOCKS} items`);
  }

  const shocks: { tokenId: string; changeBps: number }[] = [];
  const facts: Fact[] = [];
  for (const item of raw as unknown[]) {
    const o = argsOf(item, ["token", "changePercent"]);
    if (typeof o === "string" || item === null || item === undefined) {
      return invalid(tool, "each shock must be an object with token and changePercent");
    }
    if (
      typeof o.token !== "string" ||
      typeof o.changePercent !== "number" ||
      !Number.isFinite(o.changePercent)
    ) {
      return invalid(tool, "each shock needs a token and a numeric changePercent");
    }
    const bps = Math.round(o.changePercent * 100);
    if (Math.abs(o.changePercent * 100 - bps) > 1e-6) {
      return invalid(tool, "changePercent supports at most two decimal places");
    }
    const asset = resolveAsset(s, o.token);
    if (!asset) return refuse(tool, "unsupported_asset", `${o.token} is not supported here.`);
    shocks.push({ tokenId: asset.token.id, changeBps: bps });
    facts.push(fact(`${asset.token.symbol} price change`, signedPercentFromBps(bps)));
  }

  const r = whatIfPrice(s, shocks, nowMs);
  if (!r.ok) return engineRefusal(tool, r.error);

  const w = r.value.value;
  const text: Record<string, string> = { liquidatable: w.liquidatable ? "yes" : "no" };
  if (w.healthBps === "no_debt") text.health = "no debt";
  else facts.push(...healthFacts("scenario ", w.healthBps));
  facts.push(dataAgeFact(r.value.dataAgeMs));

  return {
    ok: true,
    tool,
    facts,
    notes: ["Simulated scenario, not a forecast.", ...r.value.assumptions],
    text,
    dataAgeMs: r.value.dataAgeMs,
    scenario: true,
  };
};

const proposeCard: Runner = (args, ctx) => {
  const tool = "propose_card";
  const { snapshot: s, nowMs } = ctx;
  const a = argsOf(args, ["action", "amount", "token"]);
  if (typeof a === "string") return invalid(tool, a);
  if (a.action === "guardian_deactivate" || a.action === "guardian_withdraw")
    return proposeGuardianControl(a, ctx);
  if (a.action !== "repay") return invalid(tool, "action must be: repay");
  if (!ctx.proposal) {
    return refuse(tool, "not_available", "No wallet is connected, so a card cannot be prepared.");
  }
  const wallet = ctx.proposal;

  let asset: AssetState | undefined;
  if (a.token !== undefined) {
    if (typeof a.token !== "string") return invalid(tool, "token must be a string");
    asset = resolveAsset(s, a.token);
    if (!asset) return refuse(tool, "unsupported_asset", `${a.token} is not supported here.`);
  } else {
    const first = s.borrowed.find((b) => b.internal > 0n);
    asset = first && s.assets[first.tokenId];
    if (!asset) return refuse(tool, "no_debt", "There is no debt to repay.");
  }
  const tokenId = asset.token.id;

  let amount: Atomic;
  if (a.amount === undefined) {
    amount = outstandingDebtAtomic(s, tokenId);
  } else {
    const parsed = parseAmount(a.amount, asset.token.decimals);
    if (typeof parsed === "string") return invalid(tool, parsed);
    amount = parsed;
  }

  const feeAsset = s.assets[wallet.fees.tokenId];
  if (wallet.fees.executionFee > 0n && !feeAsset) {
    return refuse(tool, "invalid_input", "The fee token is not described by this position.");
  }

  const draft = repayCard(
    s,
    { tokenId, amount, walletBalance: wallet.walletBalances[tokenId] ?? 0n },
    wallet.fees,
    nowMs,
  );
  if (!draft.ok) return engineRefusal(tool, draft.error);
  const d = draft.value;

  const payload = repayPayload(d, {
    lendingId: wallet.lendingId,
    lendingVersion: wallet.lendingVersion,
    extraDecimals: s.assets[tokenId]?.token.extraDecimals ?? -1,
    recipientRegistered: wallet.feeRecipientRegistered,
    ...(wallet.storageDepositYocto === undefined
      ? {}
      : { storageDepositYocto: wallet.storageDepositYocto }),
  });
  if (!payload.ok) return engineRefusal(tool, payload.error);

  const facts: Fact[] = [];
  for (const n of d.numbers) {
    if (n.before !== undefined)
      facts.push({ label: `${n.label} before`, value: n.before, unit: n.unit });
    if (n.after !== undefined)
      facts.push({ label: `${n.label} after`, value: n.after, unit: n.unit });
  }
  facts.push(fact("repay amount", fromAtomic(d.amount, asset.token.decimals, asset.token.symbol)));
  for (const f of d.fees) {
    facts.push(
      fact(
        "execution fee",
        fromAtomic(f.amount, feeAsset?.token.decimals ?? 0, feeAsset?.token.symbol ?? null),
      ),
    );
  }
  facts.push(dataAgeFact(d.dataAgeMs));

  const text: Record<string, string> = {
    card: "draft",
    headline: d.headline,
    risks: d.risks.join(" "),
  };
  if (d.cappedBy !== null) text.cappedBy = d.cappedBy;

  const card = assembleCard(d, {
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
      ...d.assumptions,
    ],
    text,
    dataAgeMs: d.dataAgeMs,
    scenario: false,
    card,
  };
};

/** Fixed explanations. No digits, so nothing here can be mistaken for a computed number. */
const GLOSSARY: Record<string, string> = {
  health_factor:
    "Health factor compares what your collateral is worth, after a protocol haircut, with what you owe. Higher is more comfortable; below one the position can be liquidated.",
  liquidation:
    "Liquidation is when the protocol lets someone else repay part of your loan and take some of your collateral at a discount, because your collateral no longer covers the debt enough.",
  collateral:
    "Collateral is the assets you lock in the lending protocol so you can borrow against them. If their value falls, your health factor falls with it.",
  volatility_ratio:
    "The volatility ratio is the share of an asset's value that counts toward your borrowing power. Riskier assets get a lower ratio.",
  liquidation_price:
    "The liquidation price is the price at which one collateral asset would bring your health factor down to the liquidation line, with everything else held still.",
  guardian:
    "The Guardian is a small contract you own. It can repay part of your loan on your behalf, but only within the limits you set, and it reduces liquidation risk within those limits rather than promising anything.",
  comfort_line:
    "The comfort line is a health factor you choose as the level you feel relaxed at. It is a personal preference, not a protection mechanism.",
  apr: "APR is the annual rate reported by the protocol. Here it is spread evenly over the period to give a rough comparison, not a promised return.",
  apy: "APY includes compounding. This app uses the protocol's reported APR instead and does not silently convert between the two.",
  repay:
    "Repaying sends tokens back to the lending protocol to reduce your debt, which lowers interest costs and raises your health factor.",
};

export const GLOSSARY_TERMS = Object.keys(GLOSSARY);
const LINE_TERMS = new Set(["health_factor", "liquidation", "liquidation_price"]);

const explainTerm: Runner = (args) => {
  const tool = "explain_term";
  const a = argsOf(args, ["term"]);
  if (typeof a === "string") return invalid(tool, a);
  const term = a.term;
  if (typeof term !== "string" || !Object.hasOwn(GLOSSARY, term)) {
    return invalid(tool, `term must be one of: ${GLOSSARY_TERMS.join(", ")}`);
  }
  // The liquidation line is the engine's constant, so a reply may quote it with a source.
  const line = BigInt(LIQUIDATION_LINE_BPS);
  const facts: Fact[] = LINE_TERMS.has(term)
    ? [
        { label: "health factor at the liquidation line", ...fromAtomic(line, 4, null) },
        { label: "health factor at the liquidation line", ...fromAtomic(line, 2, "%") },
      ]
    : [];
  return {
    ok: true,
    tool,
    facts,
    notes: [],
    text: { explanation: GLOSSARY[term] ?? "" },
    dataAgeMs: null,
    scenario: false,
  };
};

// --------------------------------------------------------------- registry

export const RUNNERS: Readonly<Record<string, Runner>> = {
  guardian_status: (args, ctx) => guardianTool(args, ctx, false),
  guardian_history: (args, ctx) => guardianTool(args, ctx, true),
  get_position: getPosition,
  compare_repay_vs_yield: compareRepayVsYield,
  what_if_price: whatIf,
  propose_card: proposeCard,
  quote_opening: quoteOpening,
  propose_opening: proposeOpening,
  explain_term: explainTerm,
};

export const TOOL_NAMES: readonly string[] = Object.keys(RUNNERS);

/** What the LLM sees: name, purpose and a closed argument schema. */
export function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "guardian_status",
      description:
        "Read validated Guardian policy/reserve state. Watcher liveness and activation history may be unavailable; nothing is signed or sent.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "guardian_history",
      description:
        "Read retained Guardian attempts with accepted token spend and confirmed fees. Bounded history may be truncated; transaction links are unavailable without verified evidence.",
      parameters: {
        type: "object",
        properties: {
          sinceMs: {
            type: "integer",
            minimum: 0,
            description: "Inclusive Unix timestamp in milliseconds.",
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_position",
      description:
        "Read the user's lending position: health factor, collateral, debt, prices, rates, liquidation price and the age of the data.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "compare_repay_vs_yield",
      description:
        "Compare repaying debt with earning the supply rate on the same amount over a horizon. Defaults to the whole debt over 365 days.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: 'Amount in whole tokens, for example "50". Optional.',
          },
          token: { type: "string", description: "Debt token symbol. Optional." },
          horizonDays: { type: "integer", minimum: 1, maximum: MAX_HORIZON_DAYS },
        },
        additionalProperties: false,
      },
    },
    {
      name: "what_if_price",
      description:
        "Health factor if token prices moved by the given percentages. A simulated scenario, not a forecast. Allowed range is -95 to +500 percent.",
      parameters: {
        type: "object",
        properties: {
          shocks: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SHOCKS,
            items: {
              type: "object",
              properties: {
                token: { type: "string" },
                changePercent: { type: "number", minimum: -95, maximum: 500 },
              },
              required: ["token", "changePercent"],
              additionalProperties: false,
            },
          },
        },
        required: ["shocks"],
        additionalProperties: false,
      },
    },
    {
      name: "propose_card",
      description:
        "Prepare a draft repay card for the user to review. The card is built by deterministic code; nothing is signed or sent until the user approves it in their wallet. Amount is in whole tokens and defaults to the whole debt.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["repay", "guardian_deactivate", "guardian_withdraw"] },
          amount: {
            type: "string",
            description: 'Amount in whole tokens, for example "50". Optional.',
          },
          token: { type: "string", description: "Debt token symbol. Optional." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "quote_opening",
      description:
        "Read how much more the user could borrow at a target health, from deterministic code. Read-only. Always call this before saying any maximum, health or amount for opening a position.",
      parameters: {
        type: "object",
        properties: {
          target_health_percent: {
            type: "string",
            description: 'Optional target health in percent, above 100, for example "150".',
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "propose_opening",
      description:
        "Prepare ONE draft card for the user to review: a collateral deposit or, as a separate later card, a borrow. Built by deterministic code; nothing is signed or sent until the user approves it in their wallet. Never combine the two stages in one answer.",
      parameters: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ["deposit", "borrow"] },
          amount: {
            type: "string",
            description: 'Amount in whole tokens, for example "10". Required: ask the user.',
          },
          token: { type: "string", description: "The stage's own token symbol. Optional." },
          target_health_percent: {
            type: "string",
            description: 'Optional target health in percent, above 100, for example "150".',
          },
        },
        required: ["stage", "amount"],
        additionalProperties: false,
      },
    },
    {
      name: "explain_term",
      description: "Short fixed explanation of a lending term.",
      parameters: {
        type: "object",
        properties: { term: { type: "string", enum: [...GLOSSARY_TERMS] } },
        required: ["term"],
        additionalProperties: false,
      },
    },
  ];
}
