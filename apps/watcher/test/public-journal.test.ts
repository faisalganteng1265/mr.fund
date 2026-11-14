import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPublicOperatorJournal } from "../src/public/journal";
import { GUARDIAN, WATCHER } from "./fixture";

const directories: string[] = [];
const authority = {
  network: "testnet" as const,
  watcherAccountId: WATCHER,
  guardianId: GUARDIAN,
  allowance: 100n,
};
const call = {
  signerId: WATCHER,
  receiverId: GUARDIAN,
  methodName: "request_repay" as const,
  args: { amount: "100000001" },
  gas: 300_000_000_000_000n,
  deposit: 0n as const,
};
const HASH = "11111111111111111111111111111111";
const name = `${createHash("sha256").update(`testnet\0${GUARDIAN}`).digest("hex")}.jsonl`;
async function directory() {
  // The journal refuses symlinked paths; macOS tmpdir() sits behind /var -> /private/var.
  const path = await realpath(await mkdtemp(join(tmpdir(), "mrfund-public-operator-")));
  directories.push(path);
  await chmod(path, 0o700);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform === "win32")(
  "public operator journal (POSIX directory fsync and O_NOFOLLOW required; unsupported on Windows)",
  () => {
    it("inspects an empty private directory without creating a file", async () => {
      const path = await directory();
      expect(await createPublicOperatorJournal(path, authority).inspect()).toEqual({
        kind: "empty",
      });
      expect(await readdir(path)).toEqual([]);
    });
    it("requires an absolute existing private directory without symlinks", async () => {
      const path = await directory();
      await chmod(path, 0o750);
      await expect(createPublicOperatorJournal(path, authority).inspect()).rejects.toThrow(
        "Operator journal unavailable",
      );
      await expect(
        createPublicOperatorJournal("relative/path", authority).inspect(),
      ).rejects.toThrow();
      await expect(
        createPublicOperatorJournal(join(path, "missing"), authority).inspect(),
      ).rejects.toThrow();
      await chmod(path, 0o700);
      const link = join(path, "link");
      await symlink(path, link);
      await expect(createPublicOperatorJournal(link, authority).inspect()).rejects.toThrow();
    });
    it("retains incomplete intents and recovers only a complete matching signed hash", async () => {
      const path = await directory();
      const journal = createPublicOperatorJournal(path, authority);
      await journal.begin(call);
      expect(await createPublicOperatorJournal(path, authority).inspect()).toEqual({
        kind: "blocked",
      });
      await journal.recordHash(HASH);
      expect(await createPublicOperatorJournal(path, authority).inspect()).toEqual({
        kind: "signed",
        hash: HASH,
        amount: "100000001",
      });
      await expect(createPublicOperatorJournal(path, authority).begin(call)).rejects.toThrow();
    });
    it("O_EXCL allows only one concurrent writer even when both preflights observed empty", async () => {
      const path = await directory();
      const first = createPublicOperatorJournal(path, authority);
      const second = createPublicOperatorJournal(path, authority);
      expect(await first.inspect()).toEqual({ kind: "empty" });
      expect(await second.inspect()).toEqual({ kind: "empty" });
      const results = await Promise.allSettled([first.begin(call), second.begin(call)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      await first.close();
      await second.close();
      expect((await readFile(join(path, name), "utf8")).split("\n")).toHaveLength(2);
    });
    it.each(["", "{", "{}\n", "{}\n{}\n", "x".repeat(16_385)])(
      "blocks malformed or partial journal bytes instead of treating them as empty",
      async (bytes) => {
        const path = await directory();
        await writeFile(join(path, name), bytes, { mode: 0o600 });
        expect(await createPublicOperatorJournal(path, authority).inspect()).toEqual({
          kind: "blocked",
        });
        await expect(createPublicOperatorJournal(path, authority).begin(call)).rejects.toThrow();
      },
    );
    it("rejects a journal symlink without reading its target", async () => {
      const path = await directory();
      const target = join(path, "sensitive");
      await writeFile(target, "secret");
      await symlink(target, join(path, name));
      await expect(createPublicOperatorJournal(path, authority).inspect()).rejects.toThrow(
        "Operator journal unavailable",
      );
      expect(await readFile(target, "utf8")).toBe("secret");
    });
    it("blocks a complete journal from a different watcher", async () => {
      const path = await directory();
      await writeFile(
        join(path, name),
        `${JSON.stringify({ version: 1, state: "signing", network: "testnet", guardianId: GUARDIAN, watcherAccountId: "other.testnet", amount: "100000001" })}\n${JSON.stringify({ state: "signed", hash: HASH })}\n`,
        { mode: 0o600 },
      );
      expect(await createPublicOperatorJournal(path, authority).inspect()).toEqual({
        kind: "blocked",
      });
    });
  },
);
