import { expect, it } from "vitest";
import { parseTransactionOutcome } from "../src/outcome";
import { createOutcomeReader } from "../src/outcome-rpc";
import { recorded } from "./outcome-fixtures";

const f = recorded("testnet", "repay-success");
const evidence = f.evidence as { outcome: unknown; blocks: { hash: string }[] };
it("only reads status/outcomes/blocks, preserves raw evidence and requests FINAL receipts", async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const req = JSON.parse(String(init?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    calls.push(req);
    if (req.method === "status") return Response.json({ result: { chain_id: "testnet" } });
    if (req.method === "EXPERIMENTAL_tx_status") return Response.json({ result: evidence.outcome });
    if (req.method === "block")
      return Response.json({
        result: { header: evidence.blocks.find((b) => b.hash === req.params.block_id) },
      });
    throw new Error("Unexpected mutation or method");
  };
  const r = await createOutcomeReader("https://rpc.test", "testnet", fetchImpl).read(
    f.expected,
    new AbortController().signal,
  );
  expect(r.ok && parseTransactionOutcome(r.value, f.expected, f.plan).ok).toBe(true);
  expect(calls.find((c) => c.method === "EXPERIMENTAL_tx_status")?.params).toEqual({
    tx_hash: f.expected.hash,
    sender_account_id: f.expected.signerId,
    wait_until: "FINAL",
  });
  expect(calls.every((c) => ["status", "EXPERIMENTAL_tx_status", "block"].includes(c.method))).toBe(
    true,
  );
});
it("refuses the wrong chain before looking up a transaction", async () => {
  let calls = 0;
  const r = await createOutcomeReader("https://rpc.test", "testnet", async () => {
    calls++;
    return Response.json({ result: { chain_id: "mainnet" } });
  }).read(f.expected, new AbortController().signal);
  expect(!r.ok && r.error.kind).toBe("identity_mismatch");
  expect(calls).toBe(1);
});
it("returns unknown transactions as pending evidence without retry", async () => {
  let calls = 0;
  const r = await createOutcomeReader("https://rpc.test", "testnet", async () => {
    calls++;
    return Response.json(
      calls === 1
        ? { result: { chain_id: "testnet" } }
        : { error: { cause: { name: "UNKNOWN_TRANSACTION" } } },
    );
  }).read(f.expected, new AbortController().signal);
  expect(r.ok && r.value).toBeNull();
  expect(calls).toBe(2);
});
it("sanitizes provider failures and bounds response bytes", async () => {
  const r = await createOutcomeReader("https://rpc.test", "testnet", async () => {
    throw new Error("provider-secret");
  }).read(f.expected, new AbortController().signal);
  expect(JSON.stringify(r)).not.toContain("provider-secret");
  expect(r.ok).toBe(false);
  const huge = await createOutcomeReader(
    "https://rpc.test",
    "testnet",
    async () => new Response("x".repeat(2_100_000)),
  ).read(f.expected, new AbortController().signal);
  expect(!huge.ok && huge.error.kind).toBe("limit_exceeded");
});
