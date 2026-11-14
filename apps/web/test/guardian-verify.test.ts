import {
  activationPayload,
  claimRefundPayload,
  createGuardianPayload,
  guardianOwnerPayload,
  ownerRegisterPayload,
} from "@mrfund/guardian-client";
import type { NearTransaction } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { createTransactionSigner } from "../src/execution/signer";
import {
  type GuardianExpectation,
  type GuardianIntent,
  verifyGuardianPayload,
} from "../src/guardian/verify";
import { createdViews, factory, NEAR, NOW, OWNER, policy, snapshot } from "./guardian-fixture";

const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => {
  if (!r.ok) throw new Error("fixture");
  return r.value;
};
const expectation = (
  guardian: GuardianExpectation["guardian"],
  over: Partial<GuardianExpectation> = {},
): GuardianExpectation => ({
  network: "testnet",
  session: { network: "testnet", accountId: OWNER },
  signerId: OWNER,
  factory,
  guardian,
  ...over,
});
const tamper = (p: NearTransaction[], mutate: (p: NearTransaction[]) => void) => {
  const copy = structuredClone(p);
  mutate(copy);
  return copy;
};
const act = (p: NearTransaction[]) => {
  const a = p[0]?.actions[0];
  if (!a) throw new Error("fixture");
  return a;
};

describe("verifyGuardianPayload accepts exactly what the builders emit", () => {
  it("create, claim, register, activate and each owner control", async () => {
    const created = await snapshot(createdViews);
    const active = await snapshot();
    const owner = { ownerId: OWNER, nowMs: NOW };
    const cases: [unknown, GuardianIntent, GuardianExpectation["guardian"]][] = [
      [
        unwrap(
          createGuardianPayload(factory, policy, 3n * NEAR, {
            ownerId: OWNER,
            creationPending: false,
          }),
        ),
        { kind: "create", policy, funding: 3n * NEAR },
        null,
      ],
      [unwrap(claimRefundPayload(factory.factoryId, 7n)), { kind: "claim_refund" }, null],
      [
        unwrap(ownerRegisterPayload(created, "debt_token", 1_250n * 10n ** 18n, owner)),
        { kind: "register", target: "debt_token", storageDeposit: 1_250n * 10n ** 18n },
        created,
      ],
      [
        unwrap(activationPayload(created, 500n, { ...owner, factory })).payload,
        { kind: "activate", reserve: 500n },
        created,
      ],
      [unwrap(guardianOwnerPayload(active, { kind: "pause" }, owner)), { kind: "pause" }, active],
      [
        unwrap(guardianOwnerPayload(active, { kind: "deactivate" }, owner)),
        { kind: "deactivate" },
        active,
      ],
      [
        unwrap(guardianOwnerPayload(active, { kind: "withdraw_reserve", amount: 50n }, owner)),
        { kind: "withdraw", amount: 50n },
        active,
      ],
    ];
    for (const [payload, intent, guardian] of cases) {
      const r = verifyGuardianPayload(payload, intent, expectation(guardian));
      if (!r.ok) throw new Error(`${intent.kind}: ${r.reason}`);
      expect(r.value.intent).toBe(intent.kind);
      expect(Object.isFrozen(r.value.transactions[0])).toBe(true);
    }
  });
});

describe("verifyGuardianPayload refuses anything else", async () => {
  const active = await snapshot();
  const created = await snapshot(createdViews);
  const owner = { ownerId: OWNER, nowMs: NOW };
  const create = unwrap(
    createGuardianPayload(factory, policy, 3n * NEAR, { ownerId: OWNER, creationPending: false }),
  );
  const pause = unwrap(guardianOwnerPayload(active, { kind: "pause" }, owner));
  const activate = unwrap(activationPayload(created, 500n, { ...owner, factory })).payload;
  const createIntent: GuardianIntent = { kind: "create", policy, funding: 3n * NEAR };

  it.each<[string, unknown, GuardianIntent, GuardianExpectation]>([
    [
      "an extra AddKey action",
      tamper(create, (p) => {
        (p[0] as { actions: unknown[] }).actions.push({ type: "AddKey" });
      }),
      createIntent,
      expectation(null),
    ],
    [
      "a Transfer-shaped action",
      tamper(pause, (p) => {
        (p[0] as { actions: unknown[] }).actions = [{ Transfer: { deposit: "1" } }];
      }),
      { kind: "pause" },
      expectation(active),
    ],
    ["a second transaction", [...create, ...pause], createIntent, expectation(null)],
    [
      "a wrong factory",
      tamper(create, (p) => {
        (p[0] as { receiverId: string }).receiverId = "evil-factory.testnet";
      }),
      createIntent,
      expectation(null),
    ],
    [
      "a policy that differs from the review",
      tamper(create, (p) => {
        (act(p).args.policy as Record<string, unknown>).max_per_action = "101";
      }),
      createIntent,
      expectation(null),
    ],
    [
      "funding below the factory minimum",
      unwrap(
        createGuardianPayload({ ...factory, minFunding: 1n }, policy, 2n * NEAR, {
          ownerId: OWNER,
          creationPending: false,
        }),
      ),
      { kind: "create", policy, funding: 2n * NEAR },
      expectation(null),
    ],
    [
      "create gas below 145 Tgas",
      tamper(create, (p) => {
        act(p).gas = 144n * 10n ** 12n;
      }),
      createIntent,
      expectation(null),
    ],
    ["create while a Guardian exists", create, createIntent, expectation(active)],
    [
      "a control to another receiver",
      tamper(pause, (p) => {
        (p[0] as { receiverId: string }).receiverId = "other-guardian.testnet";
      }),
      { kind: "pause" },
      expectation(active),
    ],
    [
      "a non-owner signer",
      pause,
      { kind: "pause" },
      expectation(active, {
        signerId: "bob.testnet",
        session: { network: "testnet", accountId: "bob.testnet" },
      }),
    ],
    [
      "a signer that is not the session account",
      pause,
      { kind: "pause" },
      expectation(active, { signerId: "bob.testnet" }),
    ],
    [
      "a wrong network",
      pause,
      { kind: "pause" },
      expectation(active, { session: { network: "mainnet", accountId: OWNER } }),
    ],
    [
      "a deposit other than 1 yocto",
      tamper(pause, (p) => {
        act(p).deposit = 2n;
      }),
      { kind: "pause" },
      expectation(active),
    ],
    ["a method other than the intent", pause, { kind: "resume" }, expectation(active)],
    [
      "an activation transfer to another receiver",
      tamper(activate, (p) => {
        act(p).args.receiver_id = "evil.testnet";
      }),
      { kind: "activate", reserve: 500n },
      expectation(created),
    ],
    [
      "an activation amount without the fee",
      tamper(activate, (p) => {
        act(p).args.amount = "500";
      }),
      { kind: "activate", reserve: 500n },
      expectation(created),
    ],
    [
      "an activation fee different from the one shown",
      activate,
      { kind: "activate", reserve: 500n },
      expectation(created, { factory: { ...factory, activationFee: 0n } }),
    ],
    [
      "a reserve message instead of activate",
      tamper(activate, (p) => {
        act(p).args.msg = JSON.stringify({ reserve: {} });
      }),
      { kind: "activate", reserve: 500n },
      expectation(created),
    ],
  ])("%s", (_name, payload, intent, x) => {
    expect(verifyGuardianPayload(payload, intent, x).ok).toBe(false);
  });
});

describe("the signer accepts only verified Guardian payloads", () => {
  it("refuses a look-alike object and signs a verified one", async () => {
    const active = await snapshot();
    const sent: unknown[] = [];
    const signer = createTransactionSigner(
      { method: "near-connect", accountId: OWNER, network: "testnet" },
      async () => ({
        signAndSendTransactions: async (p) => {
          sent.push(p);
          return [];
        },
      }),
    );
    if (!signer) throw new Error("fixture");
    const payload = unwrap(
      guardianOwnerPayload(active, { kind: "pause" }, { ownerId: OWNER, nowMs: NOW }),
    );
    const verified = verifyGuardianPayload(payload, { kind: "pause" }, expectation(active));
    if (!verified.ok) throw new Error(verified.reason);
    await expect(signer.signAndSend({ ...verified.value })).rejects.toThrow(/verified/);
    expect(sent).toHaveLength(0);
    await signer.signAndSend(verified.value);
    expect(sent).toEqual([
      {
        network: "testnet",
        signerId: OWNER,
        transactions: [
          {
            receiverId: "guardian.testnet",
            actions: [
              {
                type: "FunctionCall",
                params: { methodName: "pause", args: {}, gas: "30000000000000", deposit: "1" },
              },
            ],
          },
        ],
      },
    ]);
  });
});
