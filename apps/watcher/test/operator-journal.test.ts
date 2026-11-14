import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseEncode } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_GAS, type RepayCall } from "../src/core/authority";
import {
  createOperatorJournal,
  OperatorJournalPlatformError,
} from "../src/runtime/operator-journal";
import { createGuardedSignerPort } from "../src/runtime/signer-port";

const authority = {
  network: "testnet" as const,
  guardianId: "guardian.testnet",
  watcherAccountId: "watcher.testnet",
  allowance: 1n,
};
const call: RepayCall = {
  signerId: authority.watcherAccountId,
  receiverId: authority.guardianId,
  methodName: "request_repay",
  args: { amount: "5" },
  gas: REQUEST_GAS,
  deposit: 0n,
};
const hash = baseEncode(new Uint8Array(32).fill(2));
const POSIX_REQUIRED =
  "Requires Linux/macOS/WSL2: durable directory fsync and O_NOFOLLOW are unavailable on Windows.";
const dirs: string[] = [];
const directory = async () => {
  const result = await mkdtemp(join(tmpdir(), "mrfund-journal-test-"));
  dirs.push(result);
  return result;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const entries = async (dir: string) => {
  const files = await readdir(dir);
  expect(files).toHaveLength(1);
  const name = files[0];
  if (!name) throw new Error("Missing journal file");
  return (await readFile(join(dir, name), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
};
const deps = () => ({
  submissionAllowed: () => true,
  verify: async () => true,
  sign: vi.fn(async () => ({ hash, signed: "SIGNED" })),
  broadcast: vi.fn(async (_signed: string) => {}),
  lookup: async () => ({ kind: "unknown" as const }),
});

describe("single-use operator write-ahead journal", () => {
  it("refuses an injected Windows platform without exposing paths or creating a journal", async () => {
    const dir = await directory();
    let failure: unknown;
    try {
      createOperatorJournal(dir, authority, { platform: "win32" });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OperatorJournalPlatformError);
    expect(failure).toMatchObject({
      code: "unsupported_platform",
      message: "Operator journal requires Linux/macOS/WSL2 with directory fsync and O_NOFOLLOW",
    });
    expect(String(failure)).not.toContain(dir);
    expect(await readdir(dir)).toEqual([]);
    if (process.platform === "win32")
      expect(() => createOperatorJournal(dir, authority)).toThrow(OperatorJournalPlatformError);
  });
  it("persists intent before signing and hash before broadcast, then blocks a new process", async ({
    skip,
  }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const dir = await directory();
    const d = deps();
    d.sign.mockImplementation(async () => {
      expect(await entries(dir)).toMatchObject([{ state: "signing", amount: "5" }]);
      return { hash, signed: "SIGNED" };
    });
    d.broadcast.mockImplementation(async () => {
      expect(await entries(dir)).toMatchObject([{ state: "signing" }, { state: "signed", hash }]);
    });
    const port = createGuardedSignerPort(authority, {
      ...d,
      journal: createOperatorJournal(dir, authority),
    });
    expect(await port.send(call)).toEqual({ kind: "pending", hash });
    const next = deps();
    const restarted = createGuardedSignerPort(authority, {
      ...next,
      journal: createOperatorJournal(dir, authority),
    });
    await expect(restarted.send(call)).rejects.toThrow("Watcher request could not be reconciled");
    expect(next.sign).not.toHaveBeenCalled();
    expect(next.broadcast).not.toHaveBeenCalled();
  });
  it("leaves an intent locked when signing fails", async ({ skip }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const dir = await directory();
    const d = deps();
    d.sign.mockRejectedValue(new Error("sign failed"));
    const port = createGuardedSignerPort(authority, {
      ...d,
      journal: createOperatorJournal(dir, authority),
    });
    await expect(port.send(call)).rejects.toThrow();
    expect(await entries(dir)).toMatchObject([{ state: "signing" }]);
    expect(d.broadcast).not.toHaveBeenCalled();
    const another = deps();
    await expect(
      createGuardedSignerPort(authority, {
        ...another,
        journal: createOperatorJournal(dir, authority),
      }).send(call),
    ).rejects.toThrow();
    expect(another.sign).not.toHaveBeenCalled();
  });
  it("does not broadcast if the hash cannot be persisted", async () => {
    const d = deps();
    const close = vi.fn(async () => {});
    const port = createGuardedSignerPort(authority, {
      ...d,
      journal: {
        begin: async () => {},
        recordHash: async () => {
          throw new Error("disk error");
        },
        close,
      },
    });
    await expect(port.send(call)).rejects.toThrow();
    expect(d.broadcast).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(await port.send(call)).toEqual({ kind: "refused", reason: "request_unreconciled" });
  });
  it("admits only one simultaneous attempt for a Guardian", async ({ skip }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const dir = await directory();
    const first = createOperatorJournal(dir, authority);
    const second = createOperatorJournal(dir, authority);
    const outcomes = await Promise.allSettled([first.begin(call), second.begin(call)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await Promise.all([first.close(), second.close()]);
    expect(await entries(dir)).toMatchObject([{ state: "signing" }]);
  });
  it("records sandbox identity without using a public-network journal", async ({ skip }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const dir = await directory();
    const sandbox = createOperatorJournal(dir, authority, { scope: "sandbox" });
    await sandbox.begin(call);
    await sandbox.close();
    expect(await entries(dir)).toMatchObject([{ network: "sandbox" }]);
    const publicJournal = createOperatorJournal(dir, authority);
    await publicJournal.begin(call);
    await publicJournal.close();
    expect(await readdir(dir)).toHaveLength(2);
  });
});
