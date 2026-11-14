import { Account, createTransaction, KeyPair, KeyPairSigner } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepayCall } from "../src/core/authority";
import type { PublicJournalState, PublicOperatorJournal } from "../src/public/journal";
import { readWatcherConfig } from "../src/runtime/config";
import { createWatcherProvider } from "../src/runtime/near-signer";
import { startWatcher } from "../src/runtime/start";
import { prepareSubmit, readSubmitFlags } from "../src/runtime/submit";
import { fakeReads, GUARDIAN, WATCHER } from "./fixture";

afterEach(() => vi.restoreAllMocks());

const FLAGS = [
  "--submit-testnet",
  "--confirm-exclusive-key",
  "--confirm-prior-requests-reconciled",
  "--confirm-persistent-journal",
];
const env = { NEAR_NETWORK_ID: "testnet", WATCHER_OPERATOR_JOURNAL_DIR: "/var/mrfund/journal" };

const call: RepayCall = {
  signerId: WATCHER,
  receiverId: GUARDIAN,
  methodName: "request_repay",
  args: { amount: "5" },
  gas: 300_000_000_000_000n,
  deposit: 0n,
};

function fakeJournal(state: PublicJournalState | Error) {
  const begun: RepayCall[] = [];
  const journal: PublicOperatorJournal = {
    async inspect() {
      if (state instanceof Error) throw state;
      return state;
    },
    async begin(c) {
      begun.push(c);
    },
    async recordHash() {},
    async close() {},
  };
  return { journal, begun };
}

describe("single-request submit flags", () => {
  it("stays read-only without flags", () => {
    expect(readSubmitFlags(env, [])).toBeNull();
  });
  it("needs every attestation, testnet and an absolute journal directory", () => {
    expect(readSubmitFlags(env, FLAGS)).toEqual({ journalDirectory: "/var/mrfund/journal" });
    for (const changed of [
      FLAGS.slice(1),
      FLAGS.filter((flag) => flag !== "--confirm-persistent-journal"),
      [...FLAGS, "--execute"],
      [...FLAGS, "--submit-testnet"],
    ])
      expect(() => readSubmitFlags(env, changed)).toThrow("Invalid watcher submit configuration");
    expect(() => readSubmitFlags({ ...env, NEAR_NETWORK_ID: "mainnet" }, FLAGS)).toThrow(
      "Invalid watcher submit configuration",
    );
    expect(() =>
      readSubmitFlags({ ...env, WATCHER_OPERATOR_JOURNAL_DIR: "journal" }, FLAGS),
    ).toThrow("Invalid watcher submit configuration");
    expect(() => readSubmitFlags({ NEAR_NETWORK_ID: "testnet" }, FLAGS)).toThrow(
      "Invalid watcher submit configuration",
    );
  });
});

describe("single-request latch", () => {
  it("opens once for an empty journal and closes the moment a request begins", async () => {
    const { journal, begun } = fakeJournal({ kind: "empty" });
    const submit = await prepareSubmit(journal);
    expect(submit.state).toBe("single_request_available");
    expect(submit.allowed()).toBe(true);
    await submit.journal.begin(call);
    expect(submit.allowed()).toBe(false);
    expect(begun).toEqual([call]);
  });
  it("closes even when the journal write fails", async () => {
    const { journal } = fakeJournal({ kind: "empty" });
    journal.begin = async () => {
      throw new Error("disk");
    };
    const submit = await prepareSubmit(journal);
    await expect(submit.journal.begin(call)).rejects.toThrow("disk");
    expect(submit.allowed()).toBe(false);
  });
  it.each([
    { kind: "blocked" } as const,
    { kind: "signed", hash: "11111111111111111111111111111111", amount: "5" } as const,
  ])("never opens when the journal already holds a request (%j)", async (state) => {
    const submit = await prepareSubmit(fakeJournal(state).journal);
    expect(submit.state).toBe("single_request_used");
    expect(submit.allowed()).toBe(false);
  });
  it("fails startup when the journal cannot be inspected", async () => {
    await expect(prepareSubmit(fakeJournal(new Error("EACCES")).journal)).rejects.toThrow("EACCES");
  });
});

describe("watcher runtime with the single-request gate", () => {
  const config = {
    ...readWatcherConfig(
      {
        NEAR_NETWORK_ID: "testnet",
        NEAR_RPC_URL: "https://rpc.example",
        WATCHER_ACCOUNT_ID: WATCHER,
        WATCHER_KEYS_DIR: "/keys",
      },
      [GUARDIAN],
    ),
  };
  const permission = {
    FunctionCall: {
      receiver_id: GUARDIAN,
      method_names: ["request_repay"],
      allowance: "1000000000000000000000000",
    },
  };

  async function run(journalState: PublicJournalState) {
    const key = KeyPair.fromRandom("ed25519");
    const signer = new KeyPairSigner(key);
    const provider = createWatcherProvider("https://rpc.example");
    vi.spyOn(provider, "viewNodeStatus").mockResolvedValue({ chain_id: "testnet" } as never);
    vi.spyOn(provider, "viewAccessKey").mockResolvedValue({
      nonce: 4n,
      permission,
      block_hash: "block",
      block_height: 1,
    });
    // Never reaches a final outcome, so the request stays pending and nothing else can send.
    vi.spyOn(provider, "viewTransactionStatus").mockRejectedValue(new Error("not yet"));
    vi.spyOn(Account.prototype, "createTransaction").mockImplementation(
      async ({ receiverId, actions }) =>
        createTransaction(
          WATCHER,
          key.getPublicKey(),
          receiverId,
          5n,
          actions,
          new Uint8Array(32).fill(1),
        ),
    );
    const broadcast = vi.spyOn(provider, "sendTransactionUntil").mockResolvedValue({} as never);
    const { journal, begun } = fakeJournal(journalState);
    const lines: string[] = [];
    // Health 114 % against a 120 % trigger: the engine asks for a repay on the first tick.
    const reads = fakeReads(() => Date.now());
    const runtime = await startWatcher({
      config,
      provider,
      reads: reads.reads,
      key: { publicKey: key.getPublicKey().toString(), signer },
      write: (line) => lines.push(line),
      submit: { journalFor: () => journal },
    });
    return { runtime, broadcast, begun, lines };
  }

  it("sends exactly one request through the journal when health is below the trigger", async () => {
    const { runtime, broadcast, begun, lines } = await run({ kind: "empty" });
    try {
      await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1));
      await runtime.watcher.tick();
      await runtime.watcher.tick();
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(begun).toHaveLength(1);
      expect(begun[0]).toMatchObject({
        signerId: WATCHER,
        receiverId: GUARDIAN,
        methodName: "request_repay",
        deposit: 0n,
      });
      expect(lines.map((line) => JSON.parse(line).event)).toContain("request_sent");
      expect(runtime.submitState).toBe("single_request_available");
    } finally {
      runtime.stop();
    }
  });
  it("does not sign or broadcast when the journal already holds a request", async () => {
    const { runtime, broadcast, begun } = await run({ kind: "blocked" });
    try {
      await vi.waitFor(() =>
        expect(runtime.watcher.status().guardians[0]?.lastEvaluationAt).not.toBeNull(),
      );
      await runtime.watcher.tick();
      expect(broadcast).not.toHaveBeenCalled();
      expect(begun).toHaveLength(0);
      expect(runtime.watcher.status().guardians[0]).toMatchObject({
        requests: "read_only",
        readOnlyReason: "startup_uncertain",
      });
      expect(runtime.submitState).toBe("single_request_used");
    } finally {
      runtime.stop();
    }
  });
  it("stays read-only for a runtime started without the submit option", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const provider = createWatcherProvider("https://rpc.example");
    vi.spyOn(provider, "viewNodeStatus").mockResolvedValue({ chain_id: "testnet" } as never);
    vi.spyOn(provider, "viewAccessKey").mockResolvedValue({
      nonce: 4n,
      permission,
      block_hash: "block",
      block_height: 1,
    });
    const broadcast = vi.spyOn(provider, "sendTransactionUntil");
    const runtime = await startWatcher({
      config,
      provider,
      reads: fakeReads(() => Date.now()).reads,
      key: { publicKey: key.getPublicKey().toString(), signer: new KeyPairSigner(key) },
      write: () => {},
    });
    try {
      await vi.waitFor(() =>
        expect(runtime.watcher.status().guardians[0]?.lastEvaluationAt).not.toBeNull(),
      );
      expect(broadcast).not.toHaveBeenCalled();
      expect(runtime.submitState).toBe("read_only");
    } finally {
      runtime.stop();
    }
  });
});
