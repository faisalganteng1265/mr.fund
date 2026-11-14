import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import type { RepayCall, VerifiedAuthority } from "../core/authority";

export class OperatorJournalPlatformError extends Error {
  readonly code = "unsupported_platform";

  constructor() {
    super("Operator journal requires Linux/macOS/WSL2 with directory fsync and O_NOFOLLOW");
    this.name = "OperatorJournalPlatformError";
  }
}

/**
 * A single-use write-ahead record, not a queue. An existing or partially written
 * record always blocks another attempt; this module intentionally cannot clear it.
 * The directory must be private, stable, and shared by all processes for a Guardian.
 * Requires Linux/macOS/WSL2: Windows cannot provide directory fsync or O_NOFOLLOW.
 */
export function createOperatorJournal(
  directory: string,
  authority: VerifiedAuthority,
  options?: { scope?: "sandbox"; platform?: NodeJS.Platform },
) {
  if ((options?.platform ?? process.platform) === "win32" || constants.O_NOFOLLOW === undefined)
    throw new OperatorJournalPlatformError();
  const scope = options?.scope ?? authority.network;
  const name = createHash("sha256").update(`${scope}\0${authority.guardianId}`).digest("hex");
  const path = join(directory, `${name}.jsonl`);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  return {
    async begin(call: RepayCall) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Invalid journal directory");
      file = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(
          `${JSON.stringify({ version: 1, state: "signing", network: scope, guardianId: authority.guardianId, watcherAccountId: authority.watcherAccountId, amount: call.args.amount })}\n`,
        );
        await file.sync();
        const parent = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      } catch {
        await file.close().catch(() => {});
        file = undefined;
        throw new Error("Operator journal unavailable");
      }
    },
    async recordHash(hash: string) {
      if (!file) throw new Error("Operator journal unavailable");
      try {
        await file.writeFile(`${JSON.stringify({ state: "signed", hash })}\n`);
        await file.sync();
      } finally {
        await file.close();
        file = undefined;
      }
    },
    async close() {
      await file?.close();
      file = undefined;
    },
  };
}
