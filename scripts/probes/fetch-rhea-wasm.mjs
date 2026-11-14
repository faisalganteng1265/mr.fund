// Generated artifacts stay under target/. Public views only; no chain writes or keys.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const network = process.argv[2] ?? "testnet";
if (!["testnet", "mainnet"].includes(network)) throw new Error("Unknown network");
const rpcUrl = network === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com";
const accountId = network === "testnet" ? "contract.1689937928.burrow.testnet" : "contract.main.burrow.near";
let blockHash;
async function query(params) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000), body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "query", params: { ...params, ...(blockHash ? { block_id: blockHash } : { finality: "final" }), account_id: accountId } }) });
  const body = await response.json();
  if (!response.ok || body.error || body.result?.error) throw new Error(JSON.stringify(body));
  blockHash ??= body.result.block_hash;
  if (body.result.block_hash !== blockHash) throw new Error("Mixed block");
  return body.result;
}
async function view(method, args = {}) {
  const r = await query({ request_type: "call_function", method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}
const code = await query({ request_type: "view_code" });
const wasm = Buffer.from(code.code_base64, "base64");
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error("Not WASM");
const provenance = { network, rpcUrl, accountId, blockHeight: code.block_height, blockHash, codeHash: code.hash, sha256: createHash("sha256").update(wasm).digest("hex"), downloadedAt: new Date().toISOString(), version: await view("get_version"), config: await view("get_config"), assetTemplate: (await view("get_assets_paged_detailed", { from_index: 0, limit: 1 }))[0].config };
await mkdir("contracts/target/probes", { recursive: true });
await writeFile(`contracts/target/probes/rhea-${network}.wasm`, wasm);
await writeFile(`contracts/target/probes/rhea-${network}.json`, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify({ network, version: provenance.version, blockHeight: provenance.blockHeight, sha256: provenance.sha256, bytes: wasm.length }));
