import { isAbsolute } from "node:path";
import type { RepayCall } from "../core/authority";
import type { PublicOperatorJournal } from "../public/journal";

/** The only way to ask the scheduled watcher to sign: every flag, no extras, testnet only. */
const SUBMIT_FLAGS = [
  "--submit-testnet",
  "--confirm-exclusive-key",
  "--confirm-prior-requests-reconciled",
  "--confirm-persistent-journal",
] as const;

export interface SubmitConfig {
  journalDirectory: string;
}

/**
 * `null` keeps the watcher read-only. Anything between "no flags" and "all four flags on
 * testnet with an absolute journal directory" is a startup failure, never a partial enable.
 * The confirmations are operator attestations, not facts the watcher can infer.
 */
export function readSubmitFlags(
  env: Readonly<Record<string, string | undefined>>,
  flags: readonly string[],
): SubmitConfig | null {
  if (flags.length === 0) return null;
  const journalDirectory = env.WATCHER_OPERATOR_JOURNAL_DIR;
  if (
    flags.length !== SUBMIT_FLAGS.length ||
    new Set(flags).size !== flags.length ||
    !SUBMIT_FLAGS.every((flag) => flags.includes(flag)) ||
    env.NEAR_NETWORK_ID !== "testnet" ||
    !journalDirectory ||
    !isAbsolute(journalDirectory)
  )
    throw new Error("Invalid watcher submit configuration");
  return { journalDirectory };
}

export type SubmitState = "read_only" | "single_request_available" | "single_request_used";

export interface SubmitGate {
  state: SubmitState;
  /** True only until a request begins; the signer port asks this before every send. */
  allowed(): boolean;
  journal: Pick<PublicOperatorJournal, "begin" | "recordHash" | "close">;
}

/**
 * One scheduled request per installation. The journal is single-use by design (O_EXCL), so the
 * gate opens only when it is empty and closes the instant a request begins, before the journal
 * write, so a failed write, a rejection or a restart can never become a second send. A
 * non-empty journal leaves the watcher read-only until the operator reconciles it by hand.
 * Does not guarantee that the request succeeds: the contract re-checks trigger and limits.
 */
export async function prepareSubmit(journal: PublicOperatorJournal): Promise<SubmitGate> {
  const found = await journal.inspect(); // throws "Operator journal unavailable"
  let open = found.kind === "empty";
  return {
    state: open ? "single_request_available" : "single_request_used",
    allowed: () => open,
    journal: {
      async begin(call: RepayCall) {
        open = false;
        await journal.begin(call);
      },
      recordHash: (hash) => journal.recordHash(hash),
      close: () => journal.close(),
    },
  };
}
