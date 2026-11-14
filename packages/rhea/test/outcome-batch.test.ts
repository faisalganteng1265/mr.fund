import { expect, it } from "vitest";
import { parseRepayOutcome } from "../src/outcome";
import { recorded } from "./outcome-fixtures";

it("preserves a successful repay when its fee fails", () => {
  const a = recorded("testnet", "repay-success"),
    b = recorded("testnet", "fee-failure");
  const r = parseRepayOutcome([a.evidence, b.evidence], b.plan);
  expect(r.ok && r.value.execution).toBe("partial");
  expect(r.ok && r.value.transactions[0]?.accepted).toBe(1_000_000n);
});
it("preserves successful effects while a later transaction is unresolved", () => {
  const a = recorded("testnet", "repay-success"),
    b = recorded("testnet", "fee-failure");
  const r = parseRepayOutcome([a.evidence], b.plan);
  expect(r.ok && r.value.execution).toBe("pending");
  expect(r.ok && r.value.transactions[0]?.execution).toBe("succeeded");
});
it("reports a complete refund as ineffective, even though the top-level return succeeds", () => {
  const a = recorded("testnet", "full-refund");
  const r = parseRepayOutcome([a.evidence], a.plan);
  expect(r.ok && r.value.execution).toBe("failed");
});
it("retains prior verified effects even when later evidence is malformed", () => {
  const a = recorded("testnet", "repay-success"),
    b = recorded("testnet", "fee-failure");
  const r = parseRepayOutcome(
    [a.evidence, { network: "testnet", outcome: {}, blocks: [] }],
    b.plan,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.observedTransactions?.[0]?.accepted).toBe(1_000_000n);
});
