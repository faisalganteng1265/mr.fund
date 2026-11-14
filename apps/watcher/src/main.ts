import { createPublicOperatorJournal } from "./public/journal";
import { readWatcherConfig } from "./runtime/config";
import { loadWatcherKey } from "./runtime/keys";
import { createWatcherProvider } from "./runtime/near-signer";
import { createWatcherReads } from "./runtime/reads";
import { startWatcher } from "./runtime/start";
import { readSubmitFlags } from "./runtime/submit";

async function main() {
  const [guardianId, ...flags] = process.argv.slice(2);
  const config = readWatcherConfig(process.env, guardianId === undefined ? [] : [guardianId]);
  const submit = readSubmitFlags(process.env, flags);
  const key = await loadWatcherKey({
    directory: config.keysDirectory,
    guardianId: config.guardianId,
    watcherAccountId: config.watcherAccountId,
    network: config.network,
  });
  const runtime = await startWatcher({
    config,
    key,
    provider: createWatcherProvider(config.rpcUrl),
    reads: createWatcherReads(config.network, config.rpcUrl),
    write: (line) => process.stdout.write(`${line}\n`),
    ...(submit
      ? {
          submit: {
            journalFor: (authority) =>
              createPublicOperatorJournal(submit.journalDirectory, authority),
          },
        }
      : {}),
  });
  process.stdout.write(`${JSON.stringify({ event: "submit_mode", state: runtime.submitState })}\n`);
}

main().catch(() => {
  // Never print a path, RPC error, key or exception from a provider.
  process.stderr.write('{"event":"startup_failed"}\n');
  process.exitCode = 1;
});
