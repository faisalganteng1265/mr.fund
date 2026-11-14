import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OutcomeEvidence, OutcomeReader } from "@mrfund/rhea";
import { type Card, err, ok, type PositionSnapshot } from "@mrfund/shared";
import { describe, expect, it, vi } from "vitest";
import { createRepayRunner, type RunnerDeps } from "../src/execution/run";
import { createTransactionSigner } from "../src/execution/signer";
import { verifyCardPayload } from "../src/execution/verify";

const NOW = 1_800_000_000_000;
interface Recording {
  request: { hash: string; signerId: string; receiverId: string; argsJson: string };
  evidence: OutcomeEvidence;
}
function recording(name: string): Recording {
  return JSON.parse(
    readFileSync(join(__dirname, `../../../fixtures/outcomes/testnet-${name}.json`), "utf8"),
  ) as Recording;
}

/** A card whose builder-shaped payload is byte-identical to the recorded sandbox request. */
function setup(name = "repay-success", over: Partial<RunnerDeps> = {}, evidenceFrom = name) {
  const rec = recording(name);
  const evidence = recording(evidenceFrom).evidence;
  const args = JSON.parse(rec.request.argsJson) as {
    receiver_id: string;
    amount: string;
    msg: string;
  };
  const token = { id: rec.request.receiverId, symbol: "TKN", decimals: 6, extraDecimals: 12 };
  const account = rec.request.signerId;
  const card: Card = {
    id: `card-${name}`,
    action: "repay",
    headline: `Repay ${(Number(args.amount) / 1e6).toFixed(6).replace(/\.?0+$/, "")} TKN`,
    reason: "",
    numbers: [],
    assumptions: [],
    fees: [],
    risks: [],
    dataAgeMs: 1_000,
    maxDataAgeMs: 120_000,
    payload: [
      {
        receiverId: token.id,
        actions: [{ methodName: "ft_transfer_call", args, gas: 100n * 10n ** 12n, deposit: 1n }],
      },
    ],
  };
  const snapshot = (debt: bigint, blockHeight: number): PositionSnapshot => ({
    network: "testnet",
    lendingId: args.receiver_id,
    accountId: account,
    blockHeight,
    readAtMs: NOW,
    collateral: [],
    supplied: [],
    borrowed: debt > 0n ? [{ tokenId: token.id, internal: debt }] : [],
    assets: {
      [token.id]: {
        token,
        volatilityRatioBps: 9500,
        supplyAprBps: 0,
        borrowAprBps: 0,
        canBorrow: true,
        canUseAsCollateral: false,
      },
    },
    prices: {},
  });
  const reads = [snapshot(10n ** 19n + 1n, 1), snapshot(9n * 10n ** 18n + 1n, 10 ** 12)];
  const readPosition = vi.fn(async () =>
    ok(reads.shift() ?? snapshot(9n * 10n ** 18n + 1n, 10 ** 12)),
  );
  const wallet = {
    signAndSendTransactions: vi.fn(
      async (): Promise<unknown> => [
        { transaction: { hash: rec.request.hash, signer_id: account, receiver_id: token.id } },
      ],
    ),
  };
  let readerUp = true;
  const reader: OutcomeReader = {
    read: async () =>
      readerUp ? ok(evidence) : err({ kind: "rpc_unavailable", detail: "offline" }),
  };
  const deps: RunnerDeps = {
    signer: createTransactionSigner(
      { method: "near-connect", accountId: account, network: "testnet" },
      async () => wallet,
    ),
    verify: (c) =>
      verifyCardPayload(c, {
        network: "testnet",
        session: { network: "testnet", accountId: account },
        signerId: account,
        lendingId: args.receiver_id,
        feeRecipientId: "fees.test.near",
        lendingVersion: args.msg.startsWith("{") ? "0.11.0" : "0.16.2",
        token,
      }),
    readPosition,
    stillMatches: () => true,
    reader,
    now: () => NOW,
    ...over,
  };
  return {
    card,
    runner: createRepayRunner(deps),
    wallet,
    reads,
    readPosition,
    snapshot,
    setReader: (up: boolean) => {
      readerUp = up;
    },
  };
}
const signal = () => new AbortController().signal;

describe("repay runner: outcomes by observation", () => {
  it("confirms only from a parsed outcome plus a fresh lower debt", async () => {
    const s = setup();
    const r = await s.runner.execute(s.card, signal());
    expect(r).toMatchObject({
      kind: "receipt",
      receipt: {
        status: "confirmed",
        txHashes: [recording("repay-success").request.hash],
        observed: { debtDecreaseInternal: "1000000000000000000" },
      },
    });
    expect(s.runner.status(s.card.id)).toBe("done");
  });

  it("maps the recorded partial refund to a partial receipt", async () => {
    const s = setup("partial-refund-fixture-receiver");
    expect(await s.runner.execute(s.card, signal())).toMatchObject({
      kind: "receipt",
      receipt: { status: "partial" },
    });
  });

  it.each(["full-refund", "detached-failure"])(
    "refuses the recorded %s request before the wallet: its message is not a builder encoding",
    async (name) => {
      const s = setup(name);
      expect(await s.runner.execute(s.card, signal())).toMatchObject({ kind: "blocked" });
      expect(s.wallet.signAndSendTransactions).not.toHaveBeenCalled();
    },
  );

  it("keeps a receipt pending, never confirmed, when chain evidence does not match the plan", async () => {
    const s = setup("repay-success", {}, "detached-failure");
    expect(await s.runner.execute(s.card, signal())).toMatchObject({
      kind: "receipt",
      receipt: { status: "submitted" },
    });
  });

  it("keeps an unreadable outcome pending and resolves it on Check again", async () => {
    const s = setup();
    s.setReader(false);
    const first = await s.runner.execute(s.card, signal());
    expect(first).toMatchObject({ kind: "receipt", receipt: { status: "submitted" } });
    expect(s.runner.status(s.card.id)).toBe("submitted");
    s.setReader(true);
    expect(await s.runner.check(s.card.id, signal())).toMatchObject({
      receipt: { status: "confirmed" },
    });
    expect(s.wallet.signAndSendTransactions).toHaveBeenCalledOnce();
  });

  it("never confirms after a wallet error: unchanged debt means nothing observed", async () => {
    const s = setup();
    s.wallet.signAndSendTransactions.mockRejectedValueOnce(new Error("User rejected"));
    s.reads[1] = s.snapshot(10n ** 19n + 1n, 2);
    expect(await s.runner.execute(s.card, signal())).toEqual({ kind: "nothing_observed" });
    expect(await s.runner.execute(s.card, signal())).toMatchObject({ kind: "blocked" });
  });

  it("reports a debt change after a wallet error as observed, not confirmed", async () => {
    const s = setup();
    s.wallet.signAndSendTransactions.mockRejectedValueOnce(new Error("timeout"));
    expect(await s.runner.execute(s.card, signal())).toEqual({
      kind: "observed_change",
      debtBeforeInternal: 10n ** 19n + 1n,
      debtAfterInternal: 9n * 10n ** 18n + 1n,
    });
  });

  it("falls back to observation when the wallet returns a mismatched result", async () => {
    const s = setup();
    s.wallet.signAndSendTransactions.mockResolvedValueOnce([]);
    expect(await s.runner.execute(s.card, signal())).toMatchObject({ kind: "observed_change" });
  });

  it("stays locked and unknown when the position cannot be re-read after an error", async () => {
    const s = setup();
    s.wallet.signAndSendTransactions.mockRejectedValueOnce(new Error("x"));
    s.readPosition.mockResolvedValueOnce(ok(s.snapshot(10n ** 19n + 1n, 1)));
    s.readPosition.mockResolvedValueOnce(err({ kind: "rpc_unavailable", detail: "down" }) as never);
    expect(await s.runner.execute(s.card, signal())).toMatchObject({ kind: "unknown" });
    expect(s.runner.status(s.card.id)).toBe("done");
  });
});

describe("repay runner: one submission per card and pre-sign checks", () => {
  it("ignores a second activation while the first is signing", async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      s.runner.execute(s.card, signal()),
      s.runner.execute(s.card, signal()),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["blocked", "receipt"]);
    expect(s.wallet.signAndSendTransactions).toHaveBeenCalledOnce();
  });

  it("blocks without signing when the position changed, and lets a refreshed card retry", async () => {
    let matches = false;
    const s = setup("repay-success", { stillMatches: () => matches });
    expect(await s.runner.execute(s.card, signal())).toMatchObject({
      kind: "blocked",
      reason: expect.stringMatching(/changed/),
    });
    expect(s.wallet.signAndSendTransactions).not.toHaveBeenCalled();
    matches = true;
    s.reads.unshift(s.snapshot(10n ** 19n + 1n, 1));
    expect((await s.runner.execute(s.card, signal())).kind).toBe("receipt");
  });

  it("blocks a stale card, a failed fresh read and an Auth session before the wallet", async () => {
    const stale = setup();
    expect(
      await stale.runner.execute({ ...stale.card, dataAgeMs: 120_000 }, signal()),
    ).toMatchObject({ kind: "blocked" });
    const offline = setup("repay-success", {
      readPosition: async () => err({ kind: "rpc_unavailable", detail: "down" }),
    });
    expect(await offline.runner.execute(offline.card, signal())).toMatchObject({ kind: "blocked" });
    expect(offline.runner.status(offline.card.id)).toBe("idle");
    const auth = setup("repay-success", { signer: null });
    expect(await auth.runner.execute(auth.card, signal())).toMatchObject({
      kind: "blocked",
      reason: expect.stringMatching(/cannot sign/),
    });
    for (const x of [stale, offline, auth])
      expect(x.wallet.signAndSendTransactions).not.toHaveBeenCalled();
  });
});
