import { assembleCard, depositCardDraft } from "@mrfund/engine";
import type { AdapterError, OpenPositionContext } from "@mrfund/rhea";
import { collateralDepositPayload } from "@mrfund/rhea";
import type { Card, Result } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { readOpeningExecutionConfig } from "../src/execution/config";
import { createLiveOpening, type LiveOpeningDeps } from "../src/execution/open-position-live";
import { createTransactionSigner, type SigningWallet } from "../src/execution/signer";
import {
  afterBorrow,
  afterDeposit,
  borrowCard,
  ctxOf,
  DEMO,
  DEPOSIT,
  depositCard,
  FEES,
  inputOf,
  LENDING,
  NOW,
  REF,
  readerOf,
  recording,
  WRAP,
} from "./open-position-run-fixture";

type Ctx = Result<OpenPositionContext, AdapterError>;
const okCtx = (c: OpenPositionContext): Ctx => ({ ok: true, value: c });
const signal = () => new AbortController().signal;
const config: LiveOpeningDeps["config"] = {
  ok: true,
  value: {
    network: "testnet",
    lendingId: LENDING,
    feeRecipientId: FEES,
    explorerTxBase: "https://testnet.nearblocks.io/txns/",
    collateralTokenId: WRAP,
    debtTokenId: REF,
  },
};

interface Setup {
  recordingName: string;
  contexts: Ctx[];
  auth?: boolean;
  config?: LiveOpeningDeps["config"];
  network?: "testnet" | "mainnet";
  wallet?: () => Promise<unknown>;
  evidence?: (hash: string) => ReturnType<Parameters<typeof readerOf>[0]>;
}
function setup(o: Setup) {
  const rec = recording(o.recordingName);
  const calls: unknown[] = [];
  const wallet = async (): Promise<SigningWallet> => ({
    signAndSendTransactions: async (p) => {
      calls.push(p);
      if (o.wallet) return o.wallet();
      const receiverId = (p as { transactions: { receiverId: string }[] }).transactions[0]
        ?.receiverId;
      return [
        { transaction: { hash: rec.expected.hash, signer_id: DEMO, receiver_id: receiverId } },
      ];
    },
  });
  const signer = o.auth
    ? null
    : createTransactionSigner(
        { method: "near-connect", accountId: DEMO, network: "testnet" },
        wallet,
      );
  let i = 0;
  const reads = { count: 0 };
  const store = createLiveOpening({
    accountId: DEMO,
    network: o.network ?? "testnet",
    config: o.config ?? config,
    rhea: {
      view: async () => ({ ok: false, error: { kind: "rpc_unavailable", detail: "unused" } }),
    },
    reader: readerOf(o.evidence ?? ((h) => (h === rec.expected.hash ? rec.evidence : null))),
    signer,
    readContext: async () => {
      reads.count++;
      const v = o.contexts[Math.min(i++, o.contexts.length - 1)];
      if (!v) throw new Error("fixture");
      return v;
    },
    now: () => NOW,
  });
  return { store, calls, reads };
}

const borrowFlow = (over: Partial<Setup> = {}) => {
  const pre = ctxOf();
  return {
    card: borrowCard(pre),
    ...setup({
      recordingName: "borrow-delivered",
      contexts: [okCtx(pre), okCtx(pre), okCtx(afterBorrow())],
      ...over,
    }),
  };
};
const depositFlow = (over: Partial<Setup> = {}) => {
  const pre = ctxOf({}, 0n);
  return {
    card: depositCard(pre),
    ...setup({
      recordingName: "deposit-applied",
      contexts: [okCtx(pre), okCtx(pre), okCtx(afterDeposit())],
      ...over,
    }),
  };
};
const view = (s: { store: { getSnapshot(): unknown } }) =>
  s.store.getSnapshot() as { phase: string; [k: string]: unknown };

describe("blocked before any confirmation", () => {
  it("a NEAR Auth session explains it cannot sign and reads nothing", async () => {
    const s = borrowFlow({ auth: true });
    await s.store.prepare(s.card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: /cannot sign/ });
    expect(s.reads.count).toBe(0);
  });

  it("a missing configuration shows its reason, never a default", async () => {
    const s = borrowFlow({ config: { ok: false, reason: "Set NEXT_PUBLIC_X to enable." } });
    await s.store.prepare(s.card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: "Set NEXT_PUBLIC_X to enable." });
    expect(s.reads.count).toBe(0);
  });

  it("a wallet on another network is blocked", async () => {
    const s = borrowFlow({ network: "mainnet" });
    await s.store.prepare(s.card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: /different network/ });
    expect(s.reads.count).toBe(0);
  });

  it("a card that is not an opening step is refused", async () => {
    const s = borrowFlow();
    await s.store.prepare({ ...s.card, action: "repay" } as Card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: /not an opening step/ });
    expect(s.reads.count).toBe(0);
  });

  it("an unreadable position blocks and can be retried", async () => {
    const pre = ctxOf();
    const down: Ctx = { ok: false, error: { kind: "rpc_unavailable", detail: "down" } };
    const s = setup({ recordingName: "borrow-delivered", contexts: [down, okCtx(pre)] });
    const card = borrowCard(pre);
    await s.store.prepare(card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: /could not be read/ });
    s.store.cancel();
    await s.store.prepare(card, signal());
    expect(view(s).phase).toBe("confirm");
  });
});

describe("the in-app confirmation", () => {
  it("shows the borrow principal, the card's numbers and its risks before the wallet", async () => {
    const s = borrowFlow();
    await s.store.prepare(s.card, signal());
    const v = view(s);
    expect(v.phase).toBe("confirm");
    const c = (v as unknown as { confirmation: Record<string, unknown> }).confirmation;
    expect(c).toMatchObject({
      stage: "borrow",
      amount: "0.5 REF",
      fee: null,
      registrations: [],
      lendingId: LENDING,
      network: "testnet",
      accountId: DEMO,
    });
    const lines = c.lines as { label: string; value: string }[];
    expect(lines.map((l) => l.label)).toEqual(s.card.numbers.map((n) => n.label));
    expect(lines.find((l) => l.label === "Borrow APR")?.value).toMatch(/%$/);
    expect(c.risks).toEqual(s.card.risks);
    expect(s.calls).toHaveLength(0);
  });

  it("shows the deposit amount in the collateral token", async () => {
    const s = depositFlow();
    await s.store.prepare(s.card, signal());
    const c = (view(s) as unknown as { confirmation: { stage: string; amount: string } })
      .confirmation;
    expect(c).toMatchObject({ stage: "deposit", amount: "0.5 wNEAR" });
  });

  it("two prepares at once read the position once", async () => {
    const s = borrowFlow();
    await Promise.all([s.store.prepare(s.card, signal()), s.store.prepare(s.card, signal())]);
    expect(s.reads.count).toBe(1);
    expect(view(s).phase).toBe("confirm");
  });

  it("lists the NEAR attached to register the account before the wallet", async () => {
    const pre = ctxOf({}, 0n);
    const registration = { contractId: LENDING, depositYocto: 10n ** 23n };
    const draft = depositCardDraft(
      inputOf(pre),
      DEPOSIT,
      pre.walletCollateralBalance,
      { kind: "none" },
      NOW,
      {
        storage: [{ label: "Rhea registration", depositYocto: registration.depositYocto }],
      },
    );
    if (!draft.ok) throw new Error("fixture");
    const payload = collateralDepositPayload(draft.value, {
      lendingId: LENDING,
      lendingVersion: "0.11.0",
      accountId: DEMO,
      registrations: [registration],
      recipientRegistered: true,
    });
    if (!payload.ok) throw new Error("fixture");
    const card = assembleCard(draft.value, { id: "card-reg", reason: "", payload: payload.value });
    const unregistered = ctxOf(
      {
        registrations: {
          ...pre.registrations,
          lending: { registered: false, minimumYocto: 10n ** 23n },
        },
      },
      0n,
    );
    const s = setup({ recordingName: "deposit-applied", contexts: [okCtx(unregistered)] });
    await s.store.prepare(card, signal());
    const v = view(s) as unknown as { phase: string; confirmation: { registrations: unknown } };
    expect(v.phase).toBe("confirm");
    expect(v.confirmation.registrations).toEqual([{ receiverId: LENDING, near: "0.1 NEAR" }]);
  });

  it("Adjust (cancel) returns to idle without signing, and signing needs a prepared card", async () => {
    const s = borrowFlow();
    await s.store.confirm(s.card, signal());
    expect(view(s).phase).toBe("idle");
    expect(s.calls).toHaveLength(0);
    await s.store.prepare(s.card, signal());
    s.store.cancel();
    expect(view(s).phase).toBe("idle");
    await s.store.confirm(s.card, signal());
    expect(s.calls).toHaveLength(0);
  });

  it("a confirmation for one card cannot sign another", async () => {
    const s = borrowFlow();
    await s.store.prepare(s.card, signal());
    await s.store.confirm({ ...s.card, id: "other" }, signal());
    expect(s.calls).toHaveLength(0);
    expect(view(s).phase).toBe("confirm");
  });
});

describe("after the wallet", () => {
  it("a borrow is confirmed only from the observed chain, with one wallet request", async () => {
    const s = borrowFlow();
    await s.store.prepare(s.card, signal());
    await s.store.confirm(s.card, signal());
    expect(s.calls).toHaveLength(1);
    const v = view(s) as unknown as {
      phase: string;
      run: { kind: string; result: { state: string } };
      summary: unknown;
    };
    expect(v.phase).toBe("result");
    expect(v.run.result.state).toBe("confirmed");
    // No deposit result in this session, so there is no flow headline to claim.
    expect(v.summary).toBeNull();
    // A second approval of the same card is refused by the runner, not the UI alone.
    await s.store.prepare(s.card, signal());
    expect(view(s)).toMatchObject({ phase: "blocked", reason: /already submitted/ });
    expect(s.calls).toHaveLength(1);
  });

  it("a confirmed deposit makes the summary offer a borrow, and keeps the collateral", async () => {
    const s = depositFlow();
    await s.store.prepare(s.card, signal());
    await s.store.confirm(s.card, signal());
    const v = view(s) as unknown as {
      run: { result: { state: string } };
      summary: { headline: string; borrowOffered: boolean; collateralRetained: boolean };
    };
    expect(v.run.result.state).toBe("confirmed");
    expect(v.summary).toEqual({
      headline: "Deposit applied. No borrow has been requested.",
      borrowOffered: true,
      collateralRetained: true,
    });
  });

  it("a wallet error with no position change says nothing was observed, never a failure claim", async () => {
    const pre = ctxOf();
    const s = borrowFlow({
      wallet: async () => {
        throw new Error("user rejected");
      },
      contexts: [okCtx(pre), okCtx(pre), okCtx(pre)],
    });
    await s.store.prepare(s.card, signal());
    await s.store.confirm(s.card, signal());
    expect((view(s) as unknown as { run: { kind: string } }).run.kind).toBe("nothing_observed");
  });

  it("an unseen transaction stays pending until an explicit check finds it", async () => {
    let seen = false;
    const rec = recording("borrow-delivered");
    const s = borrowFlow({
      evidence: (h) => (seen && h === rec.expected.hash ? rec.evidence : null),
    });
    await s.store.prepare(s.card, signal());
    await s.store.confirm(s.card, signal());
    const pending = view(s) as unknown as { run: { result: { state: string } } };
    expect(["submitted", "unresolved"]).toContain(pending.run.result.state);
    seen = true;
    await s.store.check(s.card, signal());
    expect((view(s) as unknown as { run: { result: { state: string } } }).run.result.state).toBe(
      "confirmed",
    );
    expect(s.calls).toHaveLength(1);
  });

  it("check does nothing outside a result for that card", async () => {
    const s = borrowFlow();
    await s.store.check(s.card, signal());
    expect(view(s).phase).toBe("idle");
  });
});

describe("public opening configuration", () => {
  const base = {
    network: "testnet",
    lendingId: LENDING,
    feeRecipientId: FEES,
    collateralTokenId: WRAP,
    debtTokenId: REF,
  };
  it("needs the pair on top of the execution settings, and says which one is missing", () => {
    expect(readOpeningExecutionConfig(base)).toMatchObject({
      ok: true,
      value: { collateralTokenId: WRAP, debtTokenId: REF, lendingId: LENDING },
    });
    expect(readOpeningExecutionConfig({ ...base, collateralTokenId: undefined })).toEqual({
      ok: false,
      reason: "Set NEXT_PUBLIC_OPENING_COLLATERAL_TOKEN_ID to enable opening a position.",
    });
    expect(readOpeningExecutionConfig({ ...base, debtTokenId: undefined })).toMatchObject({
      ok: false,
      reason: /NEXT_PUBLIC_OPENING_DEBT_TOKEN_ID/,
    });
    expect(readOpeningExecutionConfig({ ...base, lendingId: undefined })).toMatchObject({
      ok: false,
      reason: /NEXT_PUBLIC_RHEA_LENDING_ID/,
    });
  });
  it("refuses a token from another network and a pair of one token", () => {
    expect(readOpeningExecutionConfig({ ...base, debtTokenId: "ref.near" })).toMatchObject({
      ok: false,
      reason: /not a testnet account/,
    });
    expect(readOpeningExecutionConfig({ ...base, debtTokenId: WRAP })).toMatchObject({
      ok: false,
      reason: /must differ/,
    });
  });
});
