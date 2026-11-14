import { Account, actions, baseEncode } from "near-api-js";
import { loadWatcherKey } from "../runtime/keys";
import { createWatcherProvider } from "../runtime/near-signer";
import { createWatcherReads } from "../runtime/reads";
import { readPublicOperatorConfig } from "./config";
import { createPublicOperatorJournal } from "./journal";
import { runPublicOverLimit } from "./operator";

async function main() {
  const config = readPublicOperatorConfig(process.env, process.argv.slice(2));
  const key = await loadWatcherKey({
    directory: config.keysDirectory,
    guardianId: config.guardianId,
    watcherAccountId: config.watcherAccountId,
    network: config.network,
  });
  const provider = createWatcherProvider(config.rpcUrl);
  const reads = createWatcherReads(config.network, config.rpcUrl);
  const account = new Account(config.watcherAccountId, provider);
  const journal = createPublicOperatorJournal(config.journalDirectory, {
    network: config.network,
    guardianId: config.guardianId,
    watcherAccountId: config.watcherAccountId,
    allowance: 0n,
  });
  const result = await runPublicOverLimit(config, {
    publicKey: key.publicKey,
    now: Date.now,
    provider,
    reads,
    journal,
    async sign(call, beforeSign) {
      const transaction = await account.createTransaction({
        receiverId: call.receiverId,
        publicKey: key.publicKey,
        actions: [actions.functionCall(call.methodName, call.args, call.gas, call.deposit)],
      });
      if (!(await beforeSign())) throw new Error("Authority changed");
      const signed = await key.signer.signTransaction(transaction);
      return { hash: baseEncode(signed.txHash), signed: signed.signedTransaction };
    },
    async broadcast(signed) {
      await provider.sendTransactionUntil(signed, "NONE");
    },
    async transaction(hash) {
      return provider.viewTransactionStatus({
        txHash: hash,
        accountId: config.watcherAccountId,
        waitUntil: "FINAL",
      });
    },
    emit(record) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    },
  });
  if (result.status !== "rejected" && result.status !== "dry_run") {
    process.stderr.write(
      `${JSON.stringify({ status: result.status, ...(typeof result.hash === "string" ? { hash: result.hash } : {}) })}\n`,
    );
    process.exitCode = 1;
  }
}
main().catch(() => {
  process.stderr.write('{"status":"refused","reason":"operator_unavailable"}\n');
  process.exitCode = 1;
});
