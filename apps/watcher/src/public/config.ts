import { isAbsolute } from "node:path";
import { readWatcherConfig, type WatcherConfig } from "../runtime/config";

export interface PublicOperatorConfig extends WatcherConfig {
  network: "testnet";
  journalDirectory: string;
  dryRun: boolean;
  /** Human prerequisites, not facts inferred from a nonce or filesystem metadata. */
  exclusiveKeyConfirmed: true;
  priorRequestsReconciled: true;
  persistentJournalConfirmed: true;
}

/** This entry is deliberately separate from the always-read-only scheduled runtime. */
export function readPublicOperatorConfig(
  env: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
): PublicOperatorConfig {
  try {
    const [guardianId, ...flags] = args;
    const required = [
      "--confirm-exclusive-key",
      "--confirm-prior-requests-reconciled",
      "--confirm-persistent-journal",
    ];
    if (
      !guardianId ||
      flags.length !== 4 ||
      new Set(flags).size !== flags.length ||
      !required.every((flag) => flags.includes(flag)) ||
      !(flags.includes("--dry-run") !== flags.includes("--execute")) ||
      env.NEAR_NETWORK_ID !== "testnet" ||
      !env.WATCHER_OPERATOR_JOURNAL_DIR ||
      !isAbsolute(env.WATCHER_OPERATOR_JOURNAL_DIR)
    )
      throw new Error();
    const config = readWatcherConfig(env, [guardianId]);
    return {
      ...config,
      network: "testnet",
      journalDirectory: env.WATCHER_OPERATOR_JOURNAL_DIR,
      dryRun: flags.includes("--dry-run"),
      exclusiveKeyConfirmed: true,
      priorRequestsReconciled: true,
      persistentJournalConfirmed: true,
    };
  } catch {
    throw new Error("Invalid public operator configuration");
  }
}
