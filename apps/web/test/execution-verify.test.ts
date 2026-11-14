import { repayPayload } from "@mrfund/rhea";
import type { Card, CardDraft, NearTransaction } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { readExecutionConfig } from "../src/execution/config";
import { assembleRepayPlan } from "../src/execution/plan";
import { type RepayExpectation, verifyCardPayload } from "../src/execution/verify";

const TOKEN = { id: "usdc.testnet", symbol: "USDC", decimals: 6, extraDecimals: 12 };
const LENDING = "contract.1689937928.burrow.testnet";
const FEES = "fees.testnet";
const ALICE = "alice.testnet";

function card(
  version: "0.11.0" | "0.16.2",
  fee: "none" | "registered" | "unregistered" = "registered",
): Card {
  const draft: CardDraft = {
    action: "repay",
    headline: "Repay 100.5 USDC",
    numbers: [{ label: "Debt", before: "1800", after: "1699.5", unit: "USDC" }],
    assumptions: [],
    fees:
      fee === "none"
        ? []
        : [
            {
              label: "Execution fee",
              amount: 250_000n,
              tokenId: TOKEN.id,
              recipientId: FEES,
              when: "now",
            },
          ],
    risks: [],
    dataAgeMs: 1_000,
    maxDataAgeMs: 120_000,
    amount: 100_500_000n,
    tokenId: TOKEN.id,
    cappedBy: null,
  };
  const payload = repayPayload(draft, {
    lendingId: LENDING,
    lendingVersion: version,
    extraDecimals: TOKEN.extraDecimals,
    recipientRegistered: fee !== "unregistered",
    storageDepositYocto: 1_250_000_000_000_000_000_000n,
  });
  if (!payload.ok) throw new Error(payload.error.kind);
  const { amount: _a, tokenId: _t, cappedBy: _c, ...rest } = draft;
  return { ...rest, id: "card-1", reason: "", payload: payload.value };
}

const expect0 = (over: Partial<RepayExpectation> = {}): RepayExpectation => ({
  network: "testnet",
  session: { network: "testnet", accountId: ALICE },
  signerId: ALICE,
  lendingId: LENDING,
  feeRecipientId: FEES,
  lendingVersion: "0.16.2",
  token: TOKEN,
  ...over,
});

/** Deep-clone a card's payload (bigint-safe) and mutate it. */
function tamper(c: Card, mutate: (p: NearTransaction[]) => void): Card {
  const payload = structuredClone(c.payload);
  mutate(payload);
  return { ...c, payload };
}
const action = (p: NearTransaction[], i = 0) => {
  const a = p[i]?.actions[0];
  if (!a) throw new Error("fixture");
  return a;
};

describe("verifyCardPayload accepts what the builders emit", () => {
  it.each([
    ["0.16.2", "none", 1],
    ["0.16.2", "registered", 2],
    ["0.16.2", "unregistered", 3],
    ["0.11.0", "registered", 2],
  ] as const)("Rhea %s, fee %s", (version, fee, count) => {
    const r = verifyCardPayload(card(version, fee), expect0({ lendingVersion: version }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.transactions.map((t) => t.role)).toEqual(
      ["repay", "registration", "fee"].filter(
        (role) =>
          role === "repay" || (fee !== "none" && (role === "fee" || fee === "unregistered")),
      ),
    );
    expect(r.value.transactions).toHaveLength(count);
    expect(r.value.amount).toBe(100_500_000n);
  });
});

describe("verifyCardPayload refuses anything else", () => {
  const ok = card("0.16.2", "unregistered");
  it.each<[string, Card, Partial<RepayExpectation>?]>([
    [
      "an extra AddKey action",
      tamper(ok, (p) => {
        (p[0] as { actions: unknown[] }).actions.push({ type: "AddKey" });
      }),
    ],
    [
      "a Transfer-shaped action",
      tamper(ok, (p) => {
        (p[0] as { actions: unknown[] }).actions = [{ Transfer: { deposit: "1" } }];
      }),
    ],
    [
      "an extra key on the action (DeployContract)",
      tamper(ok, (p) => {
        (action(p) as unknown as Record<string, unknown>).code = "wasm";
      }),
    ],
    [
      "a fourth transaction (Stake)",
      tamper(ok, (p) => {
        p.push({
          receiverId: "validator.testnet",
          actions: [{ methodName: "stake", args: {}, gas: 1n, deposit: 1n }],
        });
      }),
    ],
    [
      "a wrong token receiver",
      tamper(ok, (p) => {
        (p[0] as { receiverId: string }).receiverId = "usdt.testnet";
      }),
    ],
    [
      "a wrong lending contract",
      tamper(ok, (p) => {
        action(p).args.receiver_id = "evil.testnet";
      }),
    ],
    [
      "a wrong method",
      tamper(ok, (p) => {
        action(p).methodName = "ft_transfer";
      }),
    ],
    [
      "a wrong deposit",
      tamper(ok, (p) => {
        action(p).deposit = 2n;
      }),
    ],
    [
      "an amount that differs from the card",
      tamper(ok, (p) => {
        action(p).args.amount = "100500001";
      }),
    ],
    [
      "the 0.11.0 message on a 0.16.2 contract",
      tamper(ok, (p) => {
        action(p).args.msg = card("0.11.0").payload[0]?.actions[0]?.args.msg as string;
      }),
    ],
    [
      "a fee to another recipient",
      tamper(ok, (p) => {
        action(p, 2).args.receiver_id = "evil.testnet";
      }),
    ],
    [
      "a fee amount that differs from the card",
      tamper(ok, (p) => {
        action(p, 2).args.amount = "250001";
      }),
    ],
    [
      "an oversized registration deposit",
      tamper(ok, (p) => {
        action(p, 1).deposit = 10n ** 24n;
      }),
    ],
    [
      "a registration for another account",
      tamper(ok, (p) => {
        action(p, 1).args.account_id = "evil.testnet";
      }),
    ],
    ["a missing fee transfer", tamper(ok, (p) => p.splice(1))],
    ["a stale card", { ...ok, dataAgeMs: 120_000 }],
    ["a headline for another token", { ...ok, headline: "Repay 100.5 USDT" }],
    ["a non-repay card", { ...ok, action: "guardian_withdraw" }],
    ["a wrong network", ok, { session: { network: "mainnet", accountId: ALICE } }],
    ["a signer that is not the session account", ok, { signerId: "bob.testnet" }],
    ["a fee recipient other than configured", ok, { feeRecipientId: "other.testnet" }],
  ])("%s", (_name, c, over) => {
    expect(verifyCardPayload(c, expect0(over)).ok).toBe(false);
  });
});

describe("readExecutionConfig", () => {
  const good = { network: "testnet", lendingId: LENDING, feeRecipientId: FEES };
  it("reads public ids and the network's explorer", () => {
    expect(readExecutionConfig(good)).toEqual({
      ok: true,
      value: { ...good, explorerTxBase: "https://testnet.nearblocks.io/txns/" },
    });
  });
  it.each([
    [{ ...good, lendingId: undefined }, /NEXT_PUBLIC_RHEA_LENDING_ID/],
    [{ ...good, feeRecipientId: "" }, /NEXT_PUBLIC_FEE_RECIPIENT_ID/],
    [{ ...good, feeRecipientId: "Fees!" }, /not a testnet account/],
    [{ ...good, lendingId: "contract.main.burrow.near" }, /not a testnet account/],
    [{ ...good, network: "devnet" }, /NEXT_PUBLIC_NEAR_NETWORK_ID/],
  ])("blocks %j", (input, reason) => {
    const r = readExecutionConfig(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});

describe("assembleRepayPlan", () => {
  const verified = (() => {
    const r = verifyCardPayload(card("0.16.2", "unregistered"), expect0());
    if (!r.ok) throw new Error(r.reason);
    return r.value;
  })();
  const outcome = (hash: string, receiver: string, signer = ALICE) => ({
    transaction: { hash, signer_id: signer, receiver_id: receiver },
  });
  const outcomes = [
    outcome("7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv", TOKEN.id),
    outcome("8gWa7bJDPYoA9WaN7va6kaJ7pVyZz2cKxcW4bE2Fp3Hw", TOKEN.id),
    outcome("9hXb8cKEQZpB1XbP8wb7mbK8qWza13dLydX5cF3Gq4Jx", TOKEN.id),
  ];

  it("pairs wallet hashes with verified transactions in order", () => {
    const r = assembleRepayPlan(verified, outcomes);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.transactions.map((t) => [t.role, t.hash])).toEqual([
      ["repay", outcomes[0]?.transaction.hash],
      ["registration", outcomes[1]?.transaction.hash],
      ["fee", outcomes[2]?.transaction.hash],
    ]);
    expect(r.value).toMatchObject({ accountId: ALICE, lendingId: LENDING, tokenId: TOKEN.id });
  });

  it.each([
    ["a missing outcome", outcomes.slice(0, 2)],
    ["an extra outcome", [...outcomes, outcomes[0]]],
    ["a duplicated hash", [outcomes[0], outcomes[0], outcomes[2]]],
    [
      "another signer",
      [
        outcome("7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv", TOKEN.id, "bob.testnet"),
        outcomes[1],
        outcomes[2],
      ],
    ],
    [
      "another receiver",
      [
        outcome("7fVZ6aHCNXnz8VzM6uz5jzH6oUxYy1bJwbV3aD1Eo2Gv", "evil.testnet"),
        outcomes[1],
        outcomes[2],
      ],
    ],
    ["no outcomes", null],
  ])("refuses %s", (_name, list) => {
    expect(assembleRepayPlan(verified, list).ok).toBe(false);
  });
});
