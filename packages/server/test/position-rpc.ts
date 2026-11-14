import { readFileSync } from "node:fs";
// Historical recordings replayed by an injected local transport; not live evidence.
export const recording = JSON.parse(
  readFileSync(new URL("../../../fixtures/rhea/testnet-reads.json", import.meta.url), "utf8"),
);
export const config = {
  network: "testnet" as const,
  rpcUrl: "https://rpc.example",
  lendingId: recording._provenance.lendingId as string,
};
export const accountId: string = recording._provenance.accountId;
export function rpc(overrides: Record<string, unknown> = {}, dataRecording = recording) {
  const calls: { method: string; block?: string }[] = [];
  const fetchImpl: typeof fetch = async (_target, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "status")
      return Response.json({ result: { chain_id: overrides.chain ?? "testnet" } });
    const p = body.params;
    calls.push({ method: p.method_name, block: p.block_id });
    const args = JSON.parse(atob(p.args_base64));
    const found = dataRecording.calls.find(
      (c: { contractId: string; method: string; args: unknown }) =>
        c.contractId === p.account_id &&
        c.method === p.method_name &&
        JSON.stringify(c.args) === JSON.stringify(args),
    );
    const data = Object.hasOwn(overrides, p.method_name)
      ? overrides[p.method_name]
      : p.method_name === "get_version"
        ? "0.11.0"
        : found?.data;
    if (data === undefined) throw new Error("Unrecorded view");
    return Response.json({
      result: {
        block_hash:
          overrides.mixed === p.method_name ? "foreign" : dataRecording._provenance.blockHash,
        block_height: dataRecording._provenance.blockHeight,
        result: [...new TextEncoder().encode(JSON.stringify(data))],
      },
    });
  };
  return { fetchImpl, calls };
}
