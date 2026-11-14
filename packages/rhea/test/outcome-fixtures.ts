import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OutcomeEvidence, RepayPlan } from "../src/outcome";

interface Recording {
  request: {
    hash: string;
    signerId: string;
    receiverId: string;
    methodName: "ft_transfer_call" | "ft_transfer";
    argsJson: string;
    deposit: string;
  };
  evidence: OutcomeEvidence;
  observations: { before: RecordedPosition; after: RecordedPosition };
  _provenance: {
    kind: string;
    prices: string;
    recordedAtUnixMs: string;
    receiverFixtureWasmSha256: string;
    sourceWasm: { network: string; sha256: string; version: "0.11.0" | "0.16.2" };
  };
}
interface RecordedPosition {
  borrowed: { token_id: string; balance: string }[];
  supplied: { token_id: string; balance: string }[];
}
export function recorded(
  network: string,
  name: string,
): {
  evidence: OutcomeEvidence;
  expected: RepayPlan["transactions"][number];
  plan: RepayPlan;
  recording: Recording;
} {
  const r = JSON.parse(
    readFileSync(
      join(import.meta.dirname, `../../../fixtures/outcomes/${network}-${name}.json`),
      "utf8",
    ),
  ) as Recording;
  const tx = {
    ...r.request,
    deposit: BigInt(r.request.deposit),
    role: name === "fee-failure" ? ("fee" as const) : ("repay" as const),
  };
  const success = name === "fee-failure" ? recorded(network, "repay-success") : null;
  const a = JSON.parse(tx.argsJson) as { receiver_id: string };
  const p: RepayPlan = success
    ? { ...success.plan, transactions: [...success.plan.transactions, tx] }
    : {
        network: "testnet",
        accountId: tx.signerId,
        lendingId: a.receiver_id,
        tokenId: tx.receiverId,
        lendingVersion: r._provenance.sourceWasm.version,
        transactions: [tx],
      };
  return { evidence: r.evidence, expected: tx, plan: p, recording: r };
}
