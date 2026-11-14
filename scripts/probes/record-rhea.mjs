// Read-only fixture generator. Generated JSON is never presented as live data.
import { mkdir, writeFile } from "node:fs/promises";

const network = process.argv[2] ?? "testnet";
if (!["mainnet", "testnet"].includes(network)) throw new Error("Unknown network");
const rpcUrl = network === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com";
const lendingId = network === "testnet" ? "contract.1689937928.burrow.testnet" : "contract.main.burrow.near";
const calls = [];
let blockHash;
async function view(contractId, method, args) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ jsonrpc: "2.0", id: "fixture", method: "query", params: { request_type: "call_function", ...(blockHash ? { block_id: blockHash } : { finality: "final" }), account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
  const body = await response.json();
  if (!response.ok || body.error || body.result?.error) {
    calls.push({ contractId, method, args, error: body });
    throw new Error(`${contractId}.${method}: ${JSON.stringify(body)}`);
  }
  blockHash ??= body.result.block_hash;
  const data = JSON.parse(Buffer.from(body.result.result).toString());
  calls.push({ contractId, method, args, blockHeight: body.result.block_height, blockHash: body.result.block_hash, data });
  return data;
}
const config = await view(lendingId, "get_config", {});
await view(lendingId, "get_version", {});
let assets = [];
for (let from_index = 0; ; from_index += 20) {
  const page = await view(lendingId, "get_assets_paged_detailed", { from_index, limit: 20 });
  assets.push(...page);
  if (page.length < 20) break;
}
const infos = await view(lendingId, "get_all_token_pyth_infos", {});
const accounts = process.argv[3] ? [{ account_id: process.argv[3] }] : await view(lendingId, "get_accounts_paged", { from_index: 0, limit: 10 });
let accountId = accounts[0]?.account_id;
for (const account of accounts) {
  const detailed = await view(lendingId, "get_account", { account_id: account.account_id });
  if (detailed?.borrowed.length && detailed?.collateral.length) { accountId = account.account_id; break; }
}
if (!accountId) throw new Error("No public account found");
await view(lendingId, "get_account", { account_id: accountId });
for (const asset of assets) {
  if (!infos[asset.token_id]) continue;
  try { await view(asset.token_id, "ft_metadata", {}); } catch (error) { console.error(String(error)); }
  const info = infos[asset.token_id];
  if (info && !info.default_price) await view(config.pyth_oracle_account_id, "get_price_no_older_than", { price_id: info.price_identifier, age: config.pyth_price_valid_duration_sec });
  if (info?.extra_call) await view(asset.token_id, info.extra_call, {});
}
const fixture = { _provenance: { kind: "recorded-rpc", network, rpcUrl, lendingId, accountId, blockHash, blockHeight: calls[0].blockHeight, recordedAt: new Date().toISOString() }, calls };
await mkdir("fixtures/rhea", { recursive: true });
await writeFile(`fixtures/rhea/${network}-reads.json`, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(JSON.stringify({ ...fixture._provenance, assets: assets.length, calls: calls.length }));
