import { readWatcherConfig } from "./runtime/config";
import { loadWatcherKey } from "./runtime/keys";
import { createWatcherProvider } from "./runtime/near-signer";
import { inspectOperatorReadiness } from "./runtime/operator-preflight";
import { createWatcherReads } from "./runtime/reads";

async function main() {
  const config = readWatcherConfig(process.env, process.argv.slice(2));
  const key = await loadWatcherKey({
    directory: config.keysDirectory,
    guardianId: config.guardianId,
    watcherAccountId: config.watcherAccountId,
    network: config.network,
  });
  const result = await inspectOperatorReadiness({
    target: { network: config.network, guardianId: config.guardianId },
    watcherAccountId: config.watcherAccountId,
    publicKey: key.publicKey,
    provider: createWatcherProvider(config.rpcUrl),
    reads: createWatcherReads(config.network, config.rpcUrl),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write('{"status":"read_only","reason":"preflight_failed"}\n');
  process.exitCode = 1;
});
