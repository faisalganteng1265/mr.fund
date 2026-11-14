import type { GuardianSnapshot } from "@mrfund/guardian-client";
import { err, ok, type PositionSnapshot } from "@mrfund/shared";
import type {
  RepayRequester,
  StartupEvidence,
  SubmitResult,
  TxLookup,
  WatcherEvent,
  WatcherReads,
} from "../src/core/types";

export const NOW = 1_800_000_000_000;
export const GUARDIAN = "guardian.testnet";
export const WATCHER = "watcher.testnet";
export const LENDING = "rhea.testnet";
export const WNEAR = "wrap.testnet";
export const USDC = "usdc.testnet";
const USDC_UNIT = 10n ** 6n;

export const clock = (start = NOW) => {
  const c = { t: start, now: () => c.t };
  return c;
};

/**
 * 100 wNEAR at $5 (volatility 60%) against `debtUsdc` USDC at $1 (volatility 95%).
 * Health = 100*5*0.6*0.95 / debt, so 250 USDC is exactly 11 400 bps.
 */
export function position(nowMs: number, debtUsdc = 300n): PositionSnapshot {
  return {
    network: "testnet",
    lendingId: LENDING,
    accountId: GUARDIAN,
    blockHeight: 1,
    readAtMs: nowMs,
    collateral: [{ tokenId: WNEAR, internal: 100n * 10n ** 24n }],
    supplied: [],
    borrowed: [{ tokenId: USDC, internal: debtUsdc * USDC_UNIT * 10n ** 12n }],
    assets: {
      [WNEAR]: {
        token: { id: WNEAR, symbol: "wNEAR", decimals: 24, extraDecimals: 0 },
        volatilityRatioBps: 6000,
        supplyAprBps: 0,
        borrowAprBps: 0,
        canBorrow: false,
        canUseAsCollateral: true,
      },
      [USDC]: {
        token: { id: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12 },
        volatilityRatioBps: 9500,
        supplyAprBps: 0,
        borrowAprBps: 0,
        canBorrow: true,
        canUseAsCollateral: false,
      },
    },
    prices: {
      [WNEAR]: { multiplier: 50_000n, decimals: 28, publishTimeMs: nowMs, source: "oracle" },
      [USDC]: { multiplier: 10_000n, decimals: 10, publishTimeMs: nowMs, source: "oracle" },
    },
  };
}

type Over = {
  status?: Partial<GuardianSnapshot["status"]>;
  policy?: Partial<GuardianSnapshot["policy"]>;
  reserve?: Partial<GuardianSnapshot["reserve"]>;
  config?: Partial<GuardianSnapshot["config"]>;
  readAtMs?: number;
  network?: "testnet" | "mainnet";
};

export function guardian(nowMs: number, over: Over = {}): GuardianSnapshot {
  const ids = {
    ownerId: "alice.testnet",
    watcherId: WATCHER,
    lendingId: LENDING,
    oracleId: "oracle.testnet",
    debtTokenId: USDC,
    collateralTokenIds: [WNEAR],
    feeRecipientId: "fees.testnet",
  };
  return {
    network: over.network ?? "testnet",
    guardianId: GUARDIAN,
    blockHeight: 1,
    blockHash: "block",
    readAtMs: over.readAtMs ?? nowMs,
    config: {
      ...ids,
      activationFee: 0n,
      lendingVersion: "0.11.0",
      debtExtraDecimals: 12,
      collateralExtraDecimals: 0,
      collateralPriceId: "11".repeat(32),
      debtPriceId: "22".repeat(32),
      maxPriceAgeSec: 60,
      ...over.config,
    },
    status: { status: "active", ...ids, lastActionStartedNs: 0n, inFlight: null, ...over.status },
    policy: {
      maxPerAction: 100n * USDC_UNIT,
      lifetimeCap: 500n * USDC_UNIT,
      reserveFloor: 50n * USDC_UNIT,
      triggerHfBps: 12_000,
      targetHfBps: 15_000,
      cooldownSec: 300,
      actionFee: USDC_UNIT,
      ...over.policy,
    },
    reserve: {
      reserve: 300n * USDC_UNIT,
      floor: 50n * USDC_UNIT,
      spendable: 250n * USDC_UNIT,
      lifetimeCap: 500n * USDC_UNIT,
      spentTotal: 0n,
      lifetimeRemaining: 500n * USDC_UNIT,
      ...over.reserve,
    },
    history: {
      attempts: [],
      retainedCount: 0,
      retention: "possibly_truncated",
      limited: false,
      transactionLinks: "unavailable",
    },
    activationHistory: "unavailable",
  };
}

/** Reads that build fresh snapshots at the clock's current time unless overridden. */
export function fakeReads(now: () => number) {
  const state = {
    guardianCalls: 0,
    positionCalls: 0,
    debtUsdc: 300n,
    over: {} as Over,
    position: null as null | ((t: number) => PositionSnapshot),
    fail: null as null | "guardian" | "position",
    gate: null as null | Promise<void>,
  };
  const reads: WatcherReads = {
    async guardian() {
      state.guardianCalls += 1;
      if (state.gate) await state.gate;
      if (state.fail === "guardian")
        return err({ kind: "rpc_unavailable", detail: "Guardian RPC unavailable" });
      return ok(guardian(now(), state.over));
    },
    async position() {
      state.positionCalls += 1;
      if (state.fail === "position") return err({ kind: "bad_response", detail: "bad" });
      return ok(state.position ? state.position(now()) : position(now(), state.debtUsdc));
    },
  };
  return { reads, state };
}

export function fakeRequester(network: "testnet" | "mainnet" = "testnet") {
  const sent: bigint[] = [];
  const looked: string[] = [];
  const script = {
    submit: [] as (SubmitResult | "throw")[],
    lookup: [] as TxLookup[],
  };
  const requester: RepayRequester = {
    network,
    guardianId: GUARDIAN,
    async requestRepay(amount) {
      sent.push(amount);
      const next = script.submit.shift() ?? {
        kind: "final",
        hash: `hash-${sent.length}`,
        outcome: { outcome: "executed", opId: BigInt(sent.length), used: amount, fee: 1n },
      };
      if (next === "throw") throw new Error("socket hang up");
      return next;
    },
    async lookup(hash) {
      looked.push(hash);
      return script.lookup.shift() ?? { kind: "unknown" };
    },
  };
  return { requester, sent, looked, script };
}

export function events() {
  const list: WatcherEvent[] = [];
  return { list, log: (e: WatcherEvent) => list.push(e), names: () => list.map((e) => e.event) };
}

export const clear = async (): Promise<StartupEvidence> => ({ kind: "clear" });
