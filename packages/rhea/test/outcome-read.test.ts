import { healthBps, mood } from "@mrfund/engine";
import { err, ok, type PositionSnapshot } from "@mrfund/shared";
import { expect, it } from "vitest";
import {
  baseSnapshot,
  NOW,
  usdcAsset,
  usdcPrice,
  WNEAR,
  wnearAsset,
  wnearPrice,
} from "../../engine/test/helpers";
import { type OutcomeReader, parseRepayOutcome } from "../src/outcome";
import { readRepayOutcome, toCardReceipt } from "../src/outcome-read";
import { recorded } from "./outcome-fixtures";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
function setup(name = "repay-success") {
  const f = recorded("testnet", name),
    parsed = unwrap(parseRepayOutcome([f.evidence], f.plan));
  const initial = parsed.transactions[0]?.transactionBlockHeight ?? 0,
    final = parsed.transactions[0]?.finalBlockHeight ?? 0;
  const before = baseSnapshot({
    accountId: f.plan.accountId,
    lendingId: f.plan.lendingId,
    blockHeight: initial - 1,
    readAtMs: NOW,
    assets: {
      [WNEAR]: wnearAsset,
      [f.plan.tokenId]: { ...usdcAsset, token: { ...usdcAsset.token, id: f.plan.tokenId } },
    },
    prices: { [WNEAR]: wnearPrice, [f.plan.tokenId]: usdcPrice },
    borrowed: [{ tokenId: f.plan.tokenId, internal: 10_000_000_000_000_000_001n }],
    supplied: [],
  });
  const after: PositionSnapshot = {
    ...before,
    blockHeight: final + 1,
    borrowed: [{ tokenId: f.plan.tokenId, internal: 9_000_000_000_000_000_001n }],
  };
  const reader: OutcomeReader = { read: async () => ok(f.evidence) };
  return { ...f, parsed, before, after, reader };
}
it("confirms only after fresh observed debt reduction and uses engine health", async () => {
  const f = setup();
  const r = unwrap(
    await readRepayOutcome(f.plan, f.reader, {
      before: f.before,
      observer: { readPosition: async () => ok(f.after), health: healthBps },
      now: () => NOW,
    }),
  );
  expect(r.observation?.debtDecreaseInternal).toBe(10n ** 18n);
  const receipt = toCardReceipt(r, NOW);
  expect(receipt.status).toBe("confirmed");
  expect(receipt.observed?.healthBeforeBps).toBe("284999");
  expect(receipt.observed?.healthAfterBps).toBe("316666");
  expect(mood(f.after, receipt, 15000, NOW).state).toBe("pleased");
});
it("retains terminal execution but no invented observations on post-read failure", async () => {
  const f = setup();
  const r = unwrap(
    await readRepayOutcome(f.plan, f.reader, {
      before: f.before,
      observer: { readPosition: async () => err({ kind: "rpc_unavailable", detail: "offline" }) },
      now: () => NOW,
    }),
  );
  expect(r.execution).toBe("succeeded");
  expect(r.observation).toBeNull();
  const receipt = toCardReceipt(r, NOW);
  expect(receipt.status).toBe("submitted");
  expect(receipt.observed).toBeUndefined();
  expect(mood(f.after, receipt, 15000, NOW).state).toBe("calm");
});
it.each(["stale", "future", "account", "network", "lending", "block", "baseline", "decimals"])(
  "refuses %s observations without losing execution",
  async (kind) => {
    const f = setup();
    if (kind === "stale") f.after.readAtMs = NOW - 120001;
    if (kind === "future") f.after.readAtMs = NOW + 1;
    if (kind === "account") f.after.accountId = "other.testnet";
    if (kind === "network") f.after.network = "mainnet";
    if (kind === "lending") f.after.lendingId = "other.testnet";
    if (kind === "block") f.after.blockHeight = 0;
    if (kind === "baseline") f.before.blockHeight = f.after.blockHeight;
    if (kind === "decimals")
      f.after = {
        ...f.after,
        assets: {
          ...f.after.assets,
          [f.plan.tokenId]: {
            ...usdcAsset,
            token: { ...usdcAsset.token, id: f.plan.tokenId, extraDecimals: 0 },
          },
        },
      };
    const r = unwrap(
      await readRepayOutcome(f.plan, f.reader, {
        before: f.before,
        observer: { readPosition: async () => ok(f.after) },
        now: () => NOW,
      }),
    );
    expect(r.execution).toBe("succeeded");
    expect(r.observation).toBeNull();
  },
);
it("keeps surplus separate from accepted tokens and labels concurrent debt changes honestly", async () => {
  const f = setup("repay-surplus");
  f.before.borrowed = [{ tokenId: f.plan.tokenId, internal: 9_000_000_000_000_000_001n }];
  f.after.borrowed = [];
  f.after.supplied = [{ tokenId: f.plan.tokenId, internal: 999_999_999_999n }];
  const r = unwrap(
    await readRepayOutcome(f.plan, f.reader, {
      before: f.before,
      observer: { readPosition: async () => ok(f.after) },
      now: () => NOW,
    }),
  );
  expect(r.transactions[0]?.accepted).toBe(9_000_001n);
  expect(r.observation?.suppliedChangeInternal).toBe(999_999_999_999n);
  expect(r.observation?.debtDecreaseInternal).toBe(9_000_000_000_000_000_001n);
  f.after.borrowed = [{ tokenId: f.plan.tokenId, internal: 11_000_000_000_000_000_001n }];
  const concurrent = unwrap(
    await readRepayOutcome(f.plan, f.reader, {
      before: f.before,
      observer: { readPosition: async () => ok(f.after) },
      now: () => NOW,
    }),
  );
  expect(concurrent.observation?.debtDecreaseInternal).toBeLessThan(0n);
  expect(toCardReceipt(concurrent, NOW).status).toBe("partial");
  expect(concurrent.observationReason).toBe("observed_change_not_causal");
});
it("bounds a non-cooperative reader without sending or retrying", async () => {
  const f = setup();
  let calls = 0;
  const r = unwrap(
    await readRepayOutcome(
      f.plan,
      {
        read: () => {
          calls++;
          return new Promise(() => {});
        },
      },
      { timeoutMs: 10, now: () => NOW },
    ),
  );
  expect(calls).toBe(1);
  expect(r.execution).toBe("pending");
});
it("keeps an already observed repay when a later lookup times out", async () => {
  const a = recorded("testnet", "repay-success"),
    b = recorded("testnet", "fee-failure");
  let calls = 0;
  const r = unwrap(
    await readRepayOutcome(
      b.plan,
      {
        read: async () => {
          calls++;
          if (calls === 1) return ok(a.evidence);
          return new Promise(() => {});
        },
      },
      { timeoutMs: 10, now: () => NOW },
    ),
  );
  expect(r.execution).toBe("pending");
  expect(r.transactions[0]?.accepted).toBe(1_000_000n);
  expect(calls).toBe(2);
});
it("returns typed errors for invalid clocks rather than throwing", async () => {
  const f = setup();
  const r = await readRepayOutcome(f.plan, f.reader, {
    now: () => {
      throw new Error("invalid clock");
    },
  });
  expect(!r.ok && r.error.kind).toBe("invalid_plan");
});
it("bounds a non-cooperative post-position reader while retaining terminal execution", async () => {
  const f = setup();
  let reads = 0;
  const r = unwrap(
    await readRepayOutcome(f.plan, f.reader, {
      before: f.before,
      observer: {
        readPosition: () => {
          reads++;
          return new Promise(() => {});
        },
      },
      timeoutMs: 10,
      now: () => NOW,
    }),
  );
  expect(reads).toBe(1);
  expect(r.execution).toBe("succeeded");
  expect(r.observation).toBeNull();
  expect(toCardReceipt(r, NOW).status).toBe("submitted");
});
it("retains partial batch status after a verified debt decrease", async () => {
  const f = setup(),
    fee = recorded("testnet", "fee-failure");
  const execution = unwrap(parseRepayOutcome([f.evidence, fee.evidence], fee.plan));
  f.after.blockHeight = Math.max(...execution.transactions.map((t) => t.finalBlockHeight ?? 0)) + 1;
  const r = unwrap(
    await readRepayOutcome(
      fee.plan,
      { read: async (t) => ok(t.role === "fee" ? fee.evidence : f.evidence) },
      {
        before: f.before,
        observer: { readPosition: async () => ok(f.after), health: healthBps },
        now: () => NOW,
      },
    ),
  );
  expect(r.observation?.debtDecreaseInternal).toBe(10n ** 18n);
  const receipt = toCardReceipt(r, NOW);
  expect(receipt.status).toBe("partial");
  expect(mood(f.after, receipt, 15000, NOW).state).toBe("concerned");
});
it("retains prior verified effects when the next RPC response has a different identity", async () => {
  const a = recorded("testnet", "repay-success"),
    b = recorded("testnet", "fee-failure");
  const r = await readRepayOutcome(b.plan, {
    read: async (t) =>
      t.role === "repay"
        ? ok(a.evidence)
        : err({ kind: "identity_mismatch", detail: "Wrong transaction" }),
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.observedTransactions?.[0]?.accepted).toBe(1_000_000n);
});
