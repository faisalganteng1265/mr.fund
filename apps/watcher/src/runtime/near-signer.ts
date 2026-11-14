import type { GuardianTarget } from "@mrfund/guardian-client";
import { Account, actions, baseEncode, JsonRpcProvider, type KeyPairSigner } from "near-api-js";
import type { VerifiedAuthority } from "../core/authority";
import type { WatcherReads } from "../core/types";
import { inspectWatcherAuthority } from "./authority";
import { reconcileFinal } from "./reconcile";
import { createGuardedSignerPort, type SignerJournal } from "./signer-port";

/** One attempt only: a transport timeout is never permission to retransmit a signed request. */
export function createWatcherProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider({ url: rpcUrl }, { retries: 1 });
}

/** No owner methods or arbitrary transaction parameters enter this adapter. */
export function createNearSignerPort(input: {
  target: GuardianTarget;
  authority: VerifiedAuthority;
  publicKey: string;
  signer: KeyPairSigner;
  provider: JsonRpcProvider;
  reads: WatcherReads;
  submissionAllowed(): boolean;
  journal?: SignerJournal;
}) {
  if (input.provider.options.retries !== 1) throw new Error("Watcher RPC must use one attempt");
  const account = new Account(input.authority.watcherAccountId, input.provider);
  return createGuardedSignerPort(input.authority, {
    submissionAllowed: input.submissionAllowed,
    ...(input.journal ? { journal: input.journal } : {}),
    async verify() {
      if ((await input.signer.getPublicKey()).toString() !== input.publicKey) return false;
      const checked = await inspectWatcherAuthority({
        target: input.target,
        watcherAccountId: input.authority.watcherAccountId,
        publicKey: input.publicKey,
        provider: input.provider,
        reads: input.reads,
      });
      return (
        checked.ok &&
        checked.value.authority.guardianId === input.authority.guardianId &&
        checked.value.authority.network === input.authority.network
      );
    },
    async sign(call) {
      const transaction = await account.createTransaction({
        receiverId: call.receiverId,
        publicKey: input.publicKey,
        actions: [actions.functionCall(call.methodName, call.args, call.gas, call.deposit)],
      });
      const result = await input.signer.signTransaction(transaction);
      return { hash: baseEncode(result.txHash), signed: result.signedTransaction };
    },
    async broadcast(signed) {
      await input.provider.sendTransactionUntil(signed, "NONE");
    },
    async lookup(hash) {
      const [transaction, guardian] = await Promise.all([
        input.provider.viewTransactionStatus({
          txHash: hash,
          accountId: input.authority.watcherAccountId,
          waitUntil: "FINAL",
        }),
        input.reads.guardian(input.target),
      ]);
      return guardian.ok
        ? reconcileFinal(transaction, hash, input.authority.watcherAccountId, guardian.value)
        : { kind: "unknown" };
    },
  });
}
