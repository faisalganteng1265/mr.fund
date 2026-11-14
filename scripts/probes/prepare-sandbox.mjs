// Prepare generated WASM fixtures and local contracts; no public network writes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const network of ["testnet", "mainnet"]) run(process.execPath, ["scripts/probes/fetch-rhea-wasm.mjs", network]);
for (const manifest of ["contracts/probe/Cargo.toml", "contracts/tests/fixtures/Cargo.toml", "contracts/guardian/Cargo.toml", "contracts/guardian-factory/Cargo.toml"]) {
  run("cargo", ["near", "build", "non-reproducible-wasm", "--manifest-path", manifest, "--no-abi", "--locked"]);
}
