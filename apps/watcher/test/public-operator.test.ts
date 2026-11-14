import { err, ok } from "@mrfund/shared";
import { describe, expect, it } from "vitest";
import { readPublicOperatorConfig } from "../src/public/config";
import { type PublicOperatorDependencies, runPublicOverLimit } from "../src/public/operator";
import { GUARDIAN, guardian, NOW, WATCHER } from "./fixture";

const HASH = "11111111111111111111111111111111";
const env = {
  NEAR_NETWORK_ID: "testnet",
  NEAR_RPC_URL: "https://rpc.invalid",
  WATCHER_ACCOUNT_ID: WATCHER,
  WATCHER_KEYS_DIR: "/keys",
  WATCHER_OPERATOR_JOURNAL_DIR: "/persistent/operator",
};
const flags = [
  "--confirm-exclusive-key",
  "--confirm-prior-requests-reconciled",
  "--confirm-persistent-journal",
];
const config = () => readPublicOperatorConfig(env, [GUARDIAN, "--execute", ...flags]);

function setup() {
  let snapshot = guardian(NOW);
  const state = {
    chain: "testnet",
    permission: {
      FunctionCall: { receiver_id: GUARDIAN, method_names: ["request_repay"], allowance: "100" },
    } as unknown,
    failRead: false,
    journal: { kind: "empty" } as Awaited<
      ReturnType<PublicOperatorDependencies["journal"]["inspect"]>
    >,
    signFails: false,
    broadcastFails: false,
    hashFails: false,
    intentFails: false,
    final: true,
    missingEvent: false,
    badEvent: false,
    foreignEvent: false,
    failedReceipt: false,
    unknownReceipt: false,
    wrongTransaction: false,
    calls: [] as string[],
    output: [] as Record<string, unknown>[],
  };
  const deps: PublicOperatorDependencies<string> = {
    publicKey: "ed25519:public",
    now: () => NOW,
    provider: {
      async viewNodeStatus() {
        return { chain_id: state.chain };
      },
      async viewAccessKey() {
        return { nonce: 12n, permission: state.permission };
      },
    },
    reads: {
      async guardian() {
        return state.failRead ? err({ kind: "rpc_unavailable", detail: "secret" }) : ok(snapshot);
      },
      async position() {
        throw new Error("Position reads are not required for an early policy rejection");
      },
    },
    journal: {
      async inspect() {
        return state.journal;
      },
      async begin(call) {
        state.calls.push("intent");
        if (state.intentFails || state.journal.kind !== "empty") throw new Error("private path");
        state.journal = { kind: "blocked" };
        expect(call).toEqual({
          signerId: WATCHER,
          receiverId: GUARDIAN,
          methodName: "request_repay",
          args: { amount: "100000001" },
          gas: 300_000_000_000_000n,
          deposit: 0n,
        });
      },
      async recordHash(hash) {
        state.calls.push("hash");
        if (state.hashFails) throw new Error("secret");
        state.journal = { kind: "signed", hash, amount: "100000001" };
      },
      async close() {},
    },
    async sign(_call, beforeSign) {
      state.calls.push("prepare");
      if (!(await beforeSign()) || state.signFails) throw new Error("secret key");
      state.calls.push("sign");
      return { hash: HASH, signed: "signed bytes" };
    },
    async broadcast() {
      state.calls.push("broadcast");
      if (state.broadcastFails) throw new Error("socket secret");
    },
    async transaction(hash) {
      state.calls.push("lookup");
      snapshot.history.attempts = [
        {
          opId: 7n,
          atNs: BigInt(NOW) * 1_000_000n,
          requested: 100_000_001n,
          used: 0n,
          fee: 0n,
          outcome: "rejected",
          reason: "above_max_per_action",
        },
      ];
      const data = {
        op_id: "7",
        requested: state.badEvent ? "1" : "100000001",
        reason: "above_max_per_action",
        at_ns: String(BigInt(NOW) * 1_000_000n),
      };
      return {
        final_execution_status: state.final ? "FINAL" : "EXECUTED",
        transaction: {
          hash,
          signer_id: WATCHER,
          receiver_id: state.wrongTransaction ? "other.testnet" : GUARDIAN,
        },
        status: {
          SuccessValue: Buffer.from(
            JSON.stringify({ outcome: "rejected", op_id: "7", reason: "above_max_per_action" }),
          ).toString("base64"),
        },
        receipts_outcome: [
          {
            outcome: {
              executor_id: state.foreignEvent ? "other.testnet" : GUARDIAN,
              status: state.failedReceipt
                ? { Failure: "secret" }
                : state.unknownReceipt
                  ? {}
                  : { SuccessValue: "" },
              logs: state.missingEvent
                ? []
                : [
                    `EVENT_JSON:${JSON.stringify({ standard: "mrfund_guardian", version: "1.0.0", event: "request_rejected", data: [data] })}`,
                  ],
            },
          },
        ],
      };
    },
    emit: (record) => state.output.push(record),
  };
  return {
    state,
    deps,
    setSnapshot: (value: typeof snapshot) => {
      snapshot = value;
    },
  };
}

describe("explicit public operator configuration", () => {
  it("requires an explicit mode and independent reconciliation/persistence attestations", () => {
    expect(() => readPublicOperatorConfig(env, [GUARDIAN, ...flags])).toThrow();
    for (const flag of flags)
      expect(() =>
        readPublicOperatorConfig(env, [GUARDIAN, "--execute", ...flags.filter((v) => v !== flag)]),
      ).toThrow();
    expect(() =>
      readPublicOperatorConfig(env, [GUARDIAN, "--execute", "--dry-run", ...flags]),
    ).toThrow();
    expect(() =>
      readPublicOperatorConfig(env, [GUARDIAN, "--execute", ...flags, "--retry"]),
    ).toThrow();
  });
  it.each([
    { NEAR_NETWORK_ID: "mainnet" },
    { NEAR_RPC_URL: "http://rpc.invalid" },
    { NEAR_RPC_URL: "https://user:secret@rpc.invalid" },
    { WATCHER_ACCOUNT_ID: "watcher.near" },
    { WATCHER_OPERATOR_JOURNAL_DIR: "" },
  ])("refuses invalid public context without including configuration values: %j", (over) => {
    expect(() =>
      readPublicOperatorConfig({ ...env, ...over }, [GUARDIAN, "--execute", ...flags]),
    ).toThrow("Invalid public operator configuration");
  });
});

describe("single-use public operator", () => {
  it("dry-runs authority, state and journal checks without reserving, signing or broadcasting", async () => {
    const { deps, state } = setup();
    expect(await runPublicOverLimit({ ...config(), dryRun: true }, deps)).toMatchObject({
      status: "dry_run",
      amount: "100000001",
    });
    expect(state.calls).toEqual([]);
    expect(state.output).toEqual([
      expect.objectContaining({ label: "operator test request", status: "dry_run" }),
    ]);
  });
  it.each([
    [
      "wrong chain",
      (s: ReturnType<typeof setup>) => {
        s.state.chain = "mainnet";
      },
    ],
    [
      "full access",
      (s: ReturnType<typeof setup>) => {
        s.state.permission = "FullAccess";
      },
    ],
    [
      "wrong receiver",
      (s: ReturnType<typeof setup>) => {
        s.state.permission = {
          FunctionCall: {
            receiver_id: "other.testnet",
            method_names: ["request_repay"],
            allowance: "100",
          },
        };
      },
    ],
    [
      "broad key",
      (s: ReturnType<typeof setup>) => {
        s.state.permission = {
          FunctionCall: { receiver_id: GUARDIAN, method_names: [], allowance: "100" },
        };
      },
    ],
    [
      "unbounded key",
      (s: ReturnType<typeof setup>) => {
        s.state.permission = {
          FunctionCall: { receiver_id: GUARDIAN, method_names: ["request_repay"], allowance: null },
        };
      },
    ],
    [
      "unavailable state",
      (s: ReturnType<typeof setup>) => {
        s.state.failRead = true;
      },
    ],
    [
      "paused",
      (s: ReturnType<typeof setup>) =>
        s.setSnapshot(guardian(NOW, { status: { status: "paused" } })),
    ],
    [
      "in flight",
      (s: ReturnType<typeof setup>) =>
        s.setSnapshot(
          guardian(NOW, {
            status: {
              inFlight: { opId: 1n, amount: 0n, fee: 0n, startedNs: 1n, repayPhase: null },
            },
          }),
        ),
    ],
    [
      "cooldown",
      (s: ReturnType<typeof setup>) =>
        s.setSnapshot(
          guardian(NOW, { status: { lastActionStartedNs: BigInt(NOW - 299_999) * 1_000_000n } }),
        ),
    ],
    [
      "stale",
      (s: ReturnType<typeof setup>) => s.setSnapshot(guardian(NOW, { readAtMs: NOW - 60_001 })),
    ],
    [
      "future",
      (s: ReturnType<typeof setup>) => s.setSnapshot(guardian(NOW, { readAtMs: NOW + 1 })),
    ],
    [
      "foreign watcher",
      (s: ReturnType<typeof setup>) =>
        s.setSnapshot(guardian(NOW, { config: { watcherId: "other.testnet" } })),
    ],
    [
      "overflow",
      (s: ReturnType<typeof setup>) =>
        s.setSnapshot(guardian(NOW, { policy: { maxPerAction: (1n << 128n) - 1n } })),
    ],
    [
      "partial journal",
      (s: ReturnType<typeof setup>) => {
        s.state.journal = { kind: "blocked" };
      },
    ],
  ] as const)("refuses %s before signing, also in dry-run", async (_name, change) => {
    const s = setup();
    change(s);
    for (const dryRun of [false, true])
      expect(await runPublicOverLimit({ ...config(), dryRun }, s.deps)).toMatchObject({
        status: "refused",
      });
    expect(s.state.calls).toEqual([]);
    expect(JSON.stringify(s.state.output)).not.toContain("secret");
  });
  it("synchronizes intent then hash before its single broadcast and prints corroborated final evidence", async () => {
    const { deps, state } = setup();
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "rejected",
      hash: HASH,
    });
    expect(state.calls).toEqual(["intent", "prepare", "sign", "hash", "broadcast", "lookup"]);
    expect(state.output).toEqual([
      expect.objectContaining({
        status: "pending",
        hash: HASH,
        explorerUrl: `https://testnet.nearblocks.io/txns/${HASH}`,
        label: "operator test request",
      }),
      expect.objectContaining({
        status: "rejected",
        reason: "AboveMaxPerAction",
        event: expect.objectContaining({ reason: "above_max_per_action" }),
        history: expect.objectContaining({ requested: "100000001" }),
        label: "operator test request",
      }),
    ]);
  });
  it.each(["signFails", "hashFails", "intentFails"] as const)(
    "retains a refusal/ambiguity lock after %s and never broadcasts",
    async (failure) => {
      const { deps, state } = setup();
      state[failure] = true;
      expect(await runPublicOverLimit(config(), deps)).toMatchObject({ status: "ambiguous" });
      expect(state.calls).not.toContain("broadcast");
      if (failure !== "intentFails") {
        expect(await runPublicOverLimit(config(), deps)).toMatchObject({ status: "refused" });
        expect(state.calls.filter((c) => c === "prepare")).toHaveLength(1);
      }
    },
  );
  it("reconciles a broadcast timeout by hash and a restart never resends even after final rejection", async () => {
    const { deps, state } = setup();
    state.broadcastFails = true;
    state.final = false;
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "ambiguous",
      hash: HASH,
    });
    state.final = true;
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "rejected",
      hash: HASH,
    });
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "rejected",
      hash: HASH,
    });
    expect(state.calls.filter((c) => c === "sign")).toHaveLength(1);
    expect(state.calls.filter((c) => c === "broadcast")).toHaveLength(1);
  });
  it("refuses restart reconciliation against the wrong network", async () => {
    const { deps, state } = setup();
    state.journal = { kind: "signed", hash: HASH, amount: "100000001" };
    state.chain = "mainnet";
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "ambiguous",
      hash: HASH,
    });
    expect(state.calls).not.toContain("lookup");
  });
  it.each([
    "missingEvent",
    "badEvent",
    "foreignEvent",
    "failedReceipt",
    "unknownReceipt",
    "wrongTransaction",
  ] as const)("does not claim final rejection with %s", async (failure) => {
    const { deps, state } = setup();
    state[failure] = true;
    expect(await runPublicOverLimit(config(), deps)).toMatchObject({
      status: "ambiguous",
      hash: HASH,
    });
    expect(state.output.at(-1)).not.toHaveProperty("event");
  });
  it("refuses dry-run on a consumed journal without signing or treating it as empty", async () => {
    const { deps, state } = setup();
    state.journal = { kind: "signed", hash: HASH, amount: "100000001" };
    expect(await runPublicOverLimit({ ...config(), dryRun: true }, deps)).toMatchObject({
      status: "refused",
    });
    expect(state.calls).toEqual([]);
  });
});
