import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { baseDecode, baseEncode } from "near-api-js";
import type { RepayCall, VerifiedAuthority } from "../core/authority";
import { createOperatorJournal } from "../runtime/operator-journal";

export type PublicJournalState =
  | { kind: "empty" }
  | { kind: "blocked" }
  | { kind: "signed"; hash: string; amount: string };

export interface PublicOperatorJournal {
  inspect(): Promise<PublicJournalState>;
  begin(call: RepayCall): Promise<void>;
  recordHash(hash: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * One stable shared directory per operator installation, never a queue or a reset.
 * Ownership/privacy and fsync are checked, but persistence across host loss and
 * reconciliation of requests signed before installation require operator evidence.
 * No inspection (including dry-run) creates or changes any journal file.
 */
export function createPublicOperatorJournal(
  directory: string,
  authority: VerifiedAuthority,
): PublicOperatorJournal {
  // Keep the writer's platform refusal and exact single-use O_EXCL/fsync behavior.
  const writer = createOperatorJournal(directory, authority);
  const name = createHash("sha256")
    .update(`${authority.network}\0${authority.guardianId}`)
    .digest("hex");
  const path = join(directory, `${name}.jsonl`);
  async function privateDirectory() {
    if (!isAbsolute(directory) || (await realpath(directory)) !== resolve(directory))
      throw new Error();
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !process.getuid ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      (stat.mode & 0o700) !== 0o700
    )
      throw new Error();
    const file = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await file.stat();
      if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error();
      await file.sync();
    } finally {
      await file.close();
    }
  }
  return {
    async inspect() {
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await privateDirectory();
        try {
          file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "empty" };
          throw error;
        }
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          !process.getuid ||
          stat.uid !== process.getuid() ||
          (stat.mode & 0o077) !== 0
        )
          throw new Error();
        if (stat.size > 16_384) return { kind: "blocked" };
        const buffer = Buffer.alloc(16_385);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 16_384) return { kind: "blocked" };
        try {
          const lines = new TextDecoder("utf-8", { fatal: true })
            .decode(buffer.subarray(0, bytesRead))
            .split("\n");
          if (lines.length !== 3 || lines[2] !== "") return { kind: "blocked" };
          const intent = JSON.parse(lines[0] ?? "") as Record<string, unknown> | null;
          const signed = JSON.parse(lines[1] ?? "") as Record<string, unknown> | null;
          if (
            !intent ||
            !signed ||
            intent.version !== 1 ||
            intent.state !== "signing" ||
            intent.network !== authority.network ||
            intent.guardianId !== authority.guardianId ||
            intent.watcherAccountId !== authority.watcherAccountId ||
            typeof intent.amount !== "string" ||
            !/^[1-9][0-9]{0,38}$/.test(intent.amount) ||
            BigInt(intent.amount) > (1n << 128n) - 1n ||
            signed.state !== "signed" ||
            typeof signed.hash !== "string" ||
            !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signed.hash)
          )
            return { kind: "blocked" };
          const bytes = baseDecode(signed.hash);
          if (bytes.length !== 32 || baseEncode(bytes) !== signed.hash) return { kind: "blocked" };
          return { kind: "signed", hash: signed.hash, amount: intent.amount };
        } catch {
          return { kind: "blocked" };
        }
      } catch {
        throw new Error("Operator journal unavailable");
      } finally {
        await file?.close().catch(() => {});
      }
    },
    async begin(call) {
      try {
        await privateDirectory();
        await writer.begin(call);
      } catch {
        throw new Error("Operator journal unavailable");
      }
    },
    recordHash: (hash) => writer.recordHash(hash),
    close: () => writer.close(),
  };
}
