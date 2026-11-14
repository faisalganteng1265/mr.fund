import type { JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { constrainedRequester, type VerifiedAuthority } from "../core/authority";
import { createWatcher } from "../core/loop";
import type { WatcherReads } from "../core/types";
import type { PublicOperatorJournal } from "../public/journal";
import { inspectWatcherAuthority } from "./authority";
import type { WatcherConfig } from "./config";
import { runWatcher } from "./lifecycle";
import { createRuntimeLog } from "./log";
import { createNearSignerPort } from "./near-signer";
import { prepareSubmit, type SubmitState } from "./submit";

/**
 * Read-only unless `submit` is given. With it, one request per installation may be signed by
 * the scoped key, through the durable single-use journal, when the engine and the contract's
 * own limits agree; the operator has attested key custody and reconciled history.
 */
export async function startWatcher(input: {
  config: WatcherConfig;
  provider: JsonRpcProvider;
  reads: WatcherReads;
  key: { publicKey: string; signer: KeyPairSigner };
  write(line: string): void;
  submit?: { journalFor(authority: VerifiedAuthority): PublicOperatorJournal };
}) {
  const target = { network: input.config.network, guardianId: input.config.guardianId };
  const checked = await inspectWatcherAuthority({
    target,
    watcherAccountId: input.config.watcherAccountId,
    publicKey: input.key.publicKey,
    provider: input.provider,
    reads: input.reads,
  });
  if (!checked.ok) throw new Error("Watcher authority could not be verified");
  const log = createRuntimeLog(input.write);
  const gate = input.submit
    ? await prepareSubmit(input.submit.journalFor(checked.value.authority))
    : null;
  const submitState: SubmitState = gate?.state ?? "read_only";
  const signer = createNearSignerPort({
    target,
    authority: checked.value.authority,
    publicKey: input.key.publicKey,
    signer: input.key.signer,
    provider: input.provider,
    reads: input.reads,
    submissionAllowed: gate ? gate.allowed : () => false,
    ...(gate ? { journal: gate.journal } : {}),
  });
  const watcher = createWatcher({
    guardians: [
      {
        target,
        requester: constrainedRequester(checked.value.authority, signer),
        startup: async () => checked.value.startup,
      },
    ],
    reads: input.reads,
    clock: { now: Date.now },
    log: log.event,
    // The operator's attestations replace the nonce evidence only while the journal is unused.
    ...(submitState === "single_request_available"
      ? { operatorReconciled: [input.config.guardianId] }
      : {}),
  });
  return { watcher, stop: runWatcher(watcher, log), submitState };
}
