import type { GuardianTarget } from "@mrfund/guardian-client";
import type { WatcherReads } from "../core/types";
import { inspectWatcherAuthority } from "./authority";

/** Read-only: an access-key nonce does not establish whether a signed request is outstanding. */
export async function inspectOperatorReadiness(input: {
  target: GuardianTarget;
  watcherAccountId: string;
  publicKey: string;
  provider: Parameters<typeof inspectWatcherAuthority>[0]["provider"];
  reads: WatcherReads;
}): Promise<{ status: "read_only"; reason: string }> {
  const result = await inspectWatcherAuthority(input);
  if (!result.ok) return { status: "read_only", reason: result.error };
  // Neither a fresh nonce nor a clear Guardian in-flight field rules out an
  // earlier signed transaction that has not yet appeared on chain.
  return { status: "read_only", reason: "restart_reconciliation_unavailable" };
}
