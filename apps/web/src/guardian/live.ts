/**
 * Live Guardian store (task 3.1): block-pinned reads through `@mrfund/guardian-client`, and one
 * pipeline for every wallet step, `build → verify → wallet → re-read`. Nothing is shown as done
 * from component memory or a transaction hash; each step's result is the next chain read
 * (G-UI-3, G-UI-4).
 *
 * Permission boundary: reads are public views; signing goes only through the Connect-only
 * `TransactionSigner`, which accepts only `verifyGuardianPayload` results (G-UI-1). NEAR Auth
 * sessions get `signer: null`: everything is viewable, nothing is signable.
 * Does not guarantee: that the watcher acts (no heartbeat source is connected yet, so the
 * heartbeat is "unavailable"), that a step succeeds, or that a refund covers gas.
 */
import {
  type ActivationState,
  type FactoryInfo,
  type GuardianSnapshot,
  type GuardianViewClient,
  readActivationState,
  readFactory,
  registrationTargetId,
} from "@mrfund/guardian-client";
import type { TransactionSigner } from "../execution/signer";
import type { Network } from "../execution/verify";
import { type Heartbeat, heartbeatState } from "./controls";
import { activationProgress, type Built, nextActivationStep, type Submission } from "./flow";
import { type GuardianHoldings, type LoanIntent, type LoanOutcome, readHoldings } from "./loan";
import { verifyGuardianPayload } from "./verify";

export interface TokenFacts {
  symbol: string;
  decimals: number;
}

export type LiveGuardianState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | {
      status: "ready";
      factory: FactoryInfo;
      token: TokenFacts;
      activation: ActivationState;
      /** NEP-145 minimum for the next registration target, when one is due. */
      storageDeposit: bigint | null;
      /** Guardian-held loan facts once activated; null when not activated or unreadable. */
      holdings: GuardianHoldings | null;
      heartbeat: Heartbeat;
      readAtMs: number;
    };

export interface LiveGuardianView {
  state: LiveGuardianState;
  submission: Submission | null;
  busy: boolean;
  notice: string | null;
  /** Why signing is unavailable for this session, or null when it can sign. */
  signBlocked: string | null;
  /** The last loan step, compared across the reads before and after it. */
  loan: LoanOutcome | null;
}

export interface LiveGuardianDeps {
  client: GuardianViewClient;
  network: Network;
  factoryId: string;
  ownerId: string;
  signer: TransactionSigner | null;
  /** Latest watcher heartbeat time; no source is connected yet, so it returns null. */
  heartbeat?: () => number | null;
  now?: () => number;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** `ft_metadata` → symbol and decimals, validated; anything else is unavailable. */
export function parseTokenFacts(data: unknown): TokenFacts | null {
  const m = record(data);
  if (!m) return null;
  const { symbol, decimals } = m;
  if (typeof symbol !== "string" || !/^[\w.$-]{1,16}$/.test(symbol)) return null;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 24)
    return null;
  return { symbol, decimals };
}

/** `storage_balance_bounds().min` as a positive yocto amount. */
export function parseStorageMin(data: unknown): bigint | null {
  const m = record(data);
  if (!m || typeof m.min !== "string" || !/^[1-9]\d{0,38}$/.test(m.min)) return null;
  return BigInt(m.min);
}

/** Transaction hashes from a wallet result, when it reports any. Display only. */
export function walletHashes(outcome: unknown): string[] {
  if (!Array.isArray(outcome)) return [];
  return outcome.flatMap((o) => {
    const hash = record(record(o)?.transaction)?.hash;
    return typeof hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) ? [hash] : [];
  });
}

export function createLiveGuardian(deps: LiveGuardianDeps) {
  const now = deps.now ?? Date.now;
  let view: LiveGuardianView = {
    state: { status: "loading" },
    submission: null,
    busy: false,
    notice: null,
    loan: null,
    signBlocked: deps.signer
      ? null
      : "NEAR Auth accounts can view the Guardian but cannot sign Guardian transactions. Connect a wallet with NEAR Connect to set one up.",
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<LiveGuardianView>) => {
    view = { ...view, ...next };
    for (const l of listeners) l();
  };

  async function read(): Promise<LiveGuardianState> {
    const factory = await readFactory(deps.client, deps.factoryId);
    if (!factory.ok)
      return { status: "unavailable", reason: "The Guardian factory could not be read." };
    const meta = await deps.client.view(factory.value.debtTokenId, "ft_metadata", {});
    const token = meta.ok ? parseTokenFacts(meta.value.data) : null;
    if (!token) return { status: "unavailable", reason: "The debt token could not be read." };
    const activation = await readActivationState(
      deps.client,
      { network: deps.network, factoryId: deps.factoryId },
      deps.ownerId,
      { now },
    );
    if (!activation.ok)
      return {
        status: "unavailable",
        reason:
          activation.error.kind === "rpc_unavailable"
            ? "The network is unavailable. Try again."
            : "The Guardian returned data that could not be validated.",
      };
    let storageDeposit: bigint | null = null;
    const step = nextActivationStep(activation.value);
    if (step.kind === "register" && activation.value.kind === "created") {
      const targetId = registrationTargetId(activation.value.guardian, step.target);
      const bounds = targetId
        ? await deps.client.view(targetId, "storage_balance_bounds", {})
        : null;
      storageDeposit = bounds?.ok ? parseStorageMin(bounds.value.data) : null;
    }
    const holdings =
      activation.value.kind === "activated"
        ? await readHoldings(deps.client, activation.value.guardian, now)
        : null;
    const readAtMs = now();
    return {
      status: "ready",
      factory: factory.value,
      token,
      activation: activation.value,
      storageDeposit,
      holdings,
      heartbeat: heartbeatState(deps.heartbeat?.() ?? null, readAtMs),
      readAtMs,
    };
  }

  async function refresh() {
    const mine = ++generation;
    publish({ notice: null });
    let next: LiveGuardianState;
    try {
      next = await read();
    } catch {
      next = { status: "unavailable", reason: "The network is unavailable. Try again." };
    }
    if (mine !== generation) return;
    let submission = view.submission;
    // A submission only lingers while a sent creation is not yet visible on chain.
    if (
      next.status === "ready" &&
      (!submission || activationProgress(next.activation, submission).kind !== "unresolved")
    )
      submission = null;
    // "Check again" after a loan step compares the same "before" with the newest read.
    const loan =
      view.loan && next.status === "ready" ? { ...view.loan, after: next.holdings } : view.loan;
    publish({ state: next, submission, loan });
  }

  function guardianOf(state: LiveGuardianState): GuardianSnapshot | null {
    if (state.status !== "ready") return null;
    const a = state.activation;
    return a.kind === "created" || a.kind === "registered" || a.kind === "activated"
      ? a.guardian
      : null;
  }

  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    /** Verify, ask the wallet once, then re-read. Never reports success from the wallet alone. */
    async run(built: Built) {
      if (view.busy) return;
      const signer = deps.signer;
      if (!signer) return publish({ notice: view.signBlocked });
      if (!built.ok) return publish({ notice: built.reason });
      const state = view.state;
      if (state.status !== "ready") return publish({ notice: "Refresh the Guardian first." });
      const verified = verifyGuardianPayload(built.payload, built.intent, {
        network: deps.network,
        session: { network: signer.network, accountId: signer.accountId },
        signerId: deps.ownerId,
        factory: state.factory,
        guardian: guardianOf(state),
      });
      if (!verified.ok) return publish({ notice: verified.reason });
      const kind = built.intent.kind;
      const loanIntent: LoanIntent | null =
        kind === "collateral" || kind === "borrow" || kind === "sweep" ? kind : null;
      const before = state.holdings;
      if (loanIntent && !before) return publish({ notice: "Refresh the Guardian first." });
      publish({ busy: true, notice: null, loan: null });
      let hashes: string[] = [];
      let walletError = false;
      try {
        hashes = walletHashes(await signer.signAndSend(verified.value));
      } catch {
        walletError = true;
      }
      publish({ submission: { intent: built.intent.kind, hashes } });
      await refresh();
      if (loanIntent && before) {
        const after = view.state.status === "ready" ? view.state.holdings : null;
        publish({ loan: { intent: loanIntent, before, after, hashes, walletError } });
      }
      publish({
        busy: false,
        notice: walletError
          ? "Your wallet did not confirm the request. The Guardian was read again; it shows only what the chain reports."
          : null,
      });
    },
  };
}

export type LiveGuardian = ReturnType<typeof createLiveGuardian>;
