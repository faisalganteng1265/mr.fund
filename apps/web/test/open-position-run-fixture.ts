/**
 * Shared fixtures for the opening runner tests. The recorded evidence is real: the Gate 1 deposit
 * of 0.5 wNEAR and the 0.5 REF borrow of the demo user on Rhea 0.11.0 (fixtures/rhea/
 * opening-outcomes.json). The context is built so that the card the engine and the builders make
 * for it is byte-identical to the recorded transaction, so the parser can match them.
 */
import { readFileSync } from "node:fs";
import {
  assembleCard,
  borrowCardDraft,
  depositCardDraft,
  type OpenPositionInput,
} from "@mrfund/engine";
import {
  borrowPayload,
  collateralDepositPayload,
  type OpeningOutcomeReader,
  type OpenPositionContext,
} from "@mrfund/rhea";
import type { Card } from "@mrfund/shared";
import type { OpeningExpectation } from "../src/execution/open-position-verify";

export const NOW = 1_800_000_000_000;
export const DEMO = "d-mrf-b1ce96af6a.testnet";
export const LENDING = "contract.1689937928.burrow.testnet";
export const WRAP = "wrap.testnet";
export const REF = "ref.fakes.testnet";
export const FEES = "fees.testnet";

export const POOLS = {
  borrowedShares: 44_459_455_679_953_101_693_465n,
  borrowedBalance: 48_809_610_013_439_014_940_495n,
  suppliedShares: 370_481_008_160_211_288_092_408n,
  suppliedBalance: 377_384_649_352_991_856_987_876n,
};
export const DEPOSIT = 5n * 10n ** 23n; // 0.5 wNEAR, as recorded
export const BORROW = 5n * 10n ** 17n; // 0.5 REF, as recorded
export const TARGET = 15_000;

const fx = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/opening-outcomes.json", import.meta.url), "utf8"),
) as {
  recordings: {
    name: string;
    expected: { hash: string };
    evidence: {
      network: string;
      outcome: { final_execution_status: string };
      blocks: { height: number }[];
    };
  }[];
};
export const recording = (name: string) => {
  const r = fx.recordings.find((x) => x.name === name);
  if (!r) throw new Error(`missing recording ${name}`);
  return structuredClone(r);
};
export const finalHeightOf = (name: string) =>
  Math.max(...recording(name).evidence.blocks.map((b) => b.height));

type Override = Partial<OpenPositionContext>;
export function ctxOf(over: Override = {}, collateral = 10n ** 24n): OpenPositionContext {
  const token = (id: string, symbol: string, decimals: number) => ({
    id,
    symbol,
    decimals,
    extraDecimals: 0,
  });
  const base: OpenPositionContext = {
    snapshot: {
      network: "testnet",
      lendingId: LENDING,
      accountId: DEMO,
      blockHeight: 277_235_620,
      readAtMs: NOW,
      collateral: collateral > 0n ? [{ tokenId: WRAP, internal: collateral }] : [],
      supplied: [],
      borrowed: [],
      assets: {
        [WRAP]: {
          token: token(WRAP, "wNEAR", 24),
          volatilityRatioBps: 6000,
          supplyAprBps: 0,
          borrowAprBps: 0,
          canBorrow: false,
          canUseAsCollateral: true,
        },
        [REF]: {
          token: token(REF, "REF", 18),
          volatilityRatioBps: 7500,
          supplyAprBps: 0,
          borrowAprBps: 181,
          canBorrow: true,
          canUseAsCollateral: true,
        },
      },
      prices: {
        [WRAP]: { multiplier: 960n, decimals: 26, publishTimeMs: null, source: "default_price" },
        [REF]: { multiplier: 250n, decimals: 20, publishTimeMs: null, source: "default_price" },
      },
    },
    collateralTokenId: WRAP,
    debtTokenId: REF,
    lendingVersion: "0.11.0",
    pools: POOLS,
    accountBorrowedShares: 0n,
    availableInternal: 3n * 10n ** 23n,
    oracleValidityMs: 60_000,
    walletCollateralBalance: 15n * 10n ** 24n,
    walletDebtBalance: 0n,
    registrations: {
      lending: { registered: true, minimumYocto: 10n ** 23n },
      collateralToken: { registered: true, minimumYocto: 1_250n * 10n ** 18n },
      debtToken: { registered: true, minimumYocto: 1_250n * 10n ** 18n },
    },
    blockHeight: 277_235_620,
    blockHash: "BLOCKHASH",
  };
  return { ...base, ...over };
}

/** A context after the borrow landed: the position now carries debt. */
export function afterBorrow(over: Override = {}, blockHeight = 277_235_700): OpenPositionContext {
  const c = ctxOf({ walletDebtBalance: BORROW - 1n, blockHeight, ...over });
  return {
    ...c,
    snapshot: {
      ...c.snapshot,
      blockHeight,
      borrowed: [{ tokenId: REF, internal: BORROW + 1n }],
    },
  };
}
/** A context after the deposit landed. */
export function afterDeposit(blockHeight = 277_235_700): OpenPositionContext {
  const c = ctxOf({ blockHeight }, DEPOSIT - 1n);
  return { ...c, snapshot: { ...c.snapshot, blockHeight } };
}

export const inputOf = (ctx: OpenPositionContext, targetBps = TARGET): OpenPositionInput => ({
  snapshot: ctx.snapshot,
  collateralTokenId: ctx.collateralTokenId,
  debtTokenId: ctx.debtTokenId,
  lendingVersion: ctx.lendingVersion,
  pools: ctx.pools,
  accountBorrowedShares: ctx.accountBorrowedShares,
  availableInternal: ctx.availableInternal,
  targetBps,
  oracleValidityMs: ctx.oracleValidityMs,
});

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok)
    throw new Error(
      `fixture: ${JSON.stringify(r.error, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
  return r.value;
};
const feeParams = { recipientRegistered: true } as const;

export function borrowCard(ctx: OpenPositionContext, amount = BORROW): Card {
  const draft = unwrap(borrowCardDraft(inputOf(ctx), amount, { kind: "none" }, NOW));
  const payload = unwrap(
    borrowPayload(draft, {
      lendingId: LENDING,
      lendingVersion: "0.11.0",
      accountId: DEMO,
      registrations: [],
      extraDecimals: 0,
      ...feeParams,
    }),
  );
  return assembleCard(draft, { id: "card-borrow", reason: "", payload });
}
export function depositCard(ctx: OpenPositionContext, amount = DEPOSIT): Card {
  const draft = unwrap(
    depositCardDraft(inputOf(ctx), amount, ctx.walletCollateralBalance, { kind: "none" }, NOW),
  );
  const payload = unwrap(
    collateralDepositPayload(draft, {
      lendingId: LENDING,
      lendingVersion: "0.11.0",
      accountId: DEMO,
      registrations: [],
      ...feeParams,
    }),
  );
  return assembleCard(draft, { id: "card-deposit", reason: "", payload });
}

const sum = (lines: { tokenId: string; internal: bigint }[], id: string) =>
  lines.reduce((s, l) => (l.tokenId === id ? s + l.internal : s), 0n);
export function expectationOf(
  ctx: OpenPositionContext,
  session: { accountId: string; network: "testnet" | "mainnet" } = {
    accountId: DEMO,
    network: "testnet",
  },
): OpeningExpectation {
  const meta = (id: string) => {
    const t = ctx.snapshot.assets[id]?.token;
    if (!t) throw new Error("fixture");
    return { id: t.id, symbol: t.symbol, decimals: t.decimals, extraDecimals: t.extraDecimals };
  };
  return {
    network: "testnet",
    session,
    signerId: ctx.snapshot.accountId,
    lendingId: ctx.snapshot.lendingId,
    feeRecipientId: FEES,
    lendingVersion: ctx.lendingVersion,
    collateral: meta(WRAP),
    debt: meta(REF),
    supplied: {
      collateral: sum(ctx.snapshot.supplied, WRAP),
      debt: sum(ctx.snapshot.supplied, REF),
    },
    registrations: {
      lending: ctx.registrations.lending,
      debtToken: ctx.registrations.debtToken,
    },
  };
}

/** Serves recorded evidence by hash; `null` hashes answer "unavailable". */
export function readerOf(
  serve: (hash: string) => { network: string; outcome: unknown; blocks: unknown[] } | null | "down",
): OpeningOutcomeReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async read(lookup) {
      reads.push(lookup.hash);
      const v = serve(lookup.hash);
      if (v === "down") return { ok: false, error: { kind: "rpc_unavailable", detail: "down" } };
      return { ok: true, value: v as never };
    },
  };
}
