import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { KeyPairSigner, type KeyPairString } from "near-api-js";
import { accountMatchesNetwork } from "../core/authority";

export class WatcherKeyPlatformError extends Error {
  readonly code = "unsupported_platform";

  constructor() {
    super("Watcher key loading requires Linux/macOS/WSL2 with O_NOFOLLOW");
    this.name = "WatcherKeyPlatformError";
  }
}

/**
 * Read the existing near-cli JSON key file named after the Guardian; never expose its contents.
 * Requires Linux/macOS/WSL2 so O_NOFOLLOW protects the key-file open.
 */
export async function loadWatcherKey(
  input: {
    directory: string;
    guardianId: string;
    watcherAccountId: string;
    network: "testnet" | "mainnet";
  },
  options?: { platform?: NodeJS.Platform },
): Promise<{ publicKey: string; signer: KeyPairSigner }> {
  if (
    !input.directory ||
    !accountMatchesNetwork(input.guardianId, input.network) ||
    !accountMatchesNetwork(input.watcherAccountId, input.network)
  )
    throw new Error("Invalid watcher key configuration");
  if ((options?.platform ?? process.platform) === "win32" || constants.O_NOFOLLOW === undefined)
    throw new WatcherKeyPlatformError();
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(
      join(input.directory, `${input.guardianId}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16_384) throw new Error();
    const buffer = Buffer.alloc(16_385);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16_384) throw new Error();
    const data: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)),
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const entry = data as Record<string, unknown>;
    if (entry.account_id !== input.watcherAccountId || typeof entry.public_key !== "string")
      throw new Error();
    const secret = entry.private_key ?? entry.secret_key;
    if (
      typeof secret !== "string" ||
      !secret.startsWith("ed25519:") ||
      (entry.private_key !== undefined &&
        entry.secret_key !== undefined &&
        entry.private_key !== entry.secret_key)
    )
      throw new Error();
    const signer = KeyPairSigner.fromSecretKey(secret as KeyPairString);
    const publicKey = (await signer.getPublicKey()).toString();
    if (publicKey !== entry.public_key) throw new Error();
    return { publicKey, signer };
  } catch {
    throw new Error("Watcher key unavailable or invalid");
  } finally {
    await file?.close().catch(() => {});
  }
}
