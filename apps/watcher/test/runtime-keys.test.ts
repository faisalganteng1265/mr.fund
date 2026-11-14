import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { afterEach, describe, expect, it } from "vitest";
import { loadWatcherKey, WatcherKeyPlatformError } from "../src/runtime/keys";

const directories: string[] = [];
const POSIX_REQUIRED =
  "Requires Linux/macOS/WSL2: the watcher key loader needs O_NOFOLLOW; Windows is unsupported.";
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "watcher-test-"));
  directories.push(directory);
  const key = KeyPair.fromRandom("ed25519");
  const input = {
    directory,
    guardianId: "guardian.testnet",
    watcherAccountId: "watcher.testnet",
    network: "testnet" as const,
  };
  const entry = {
    account_id: input.watcherAccountId,
    public_key: key.getPublicKey().toString(),
    private_key: key.toString(),
  };
  const path = join(directory, "guardian.testnet.json");
  return { key, input, entry, path };
}

describe("watcher local key source", () => {
  it("refuses an injected Windows platform with a typed error that does not expose key paths", async () => {
    const input = {
      directory: "PRIVATE_DIRECTORY_SENTINEL",
      guardianId: "guardian.testnet",
      watcherAccountId: "watcher.testnet",
      network: "testnet" as const,
    };
    const failure = await loadWatcherKey(input, { platform: "win32" }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(WatcherKeyPlatformError);
    expect(failure).toMatchObject({
      code: "unsupported_platform",
      message: "Watcher key loading requires Linux/macOS/WSL2 with O_NOFOLLOW",
    });
    expect(String(failure)).not.toContain(input.directory);
    if (process.platform === "win32")
      await expect(loadWatcherKey(input)).rejects.toThrow(WatcherKeyPlatformError);
  });
  it("loads only the matching local account and validates the derived public key", async ({
    skip,
  }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const { input, entry, path } = await setup();
    await writeFile(path, JSON.stringify(entry), { mode: 0o600 });
    const loaded = await loadWatcherKey(input);
    expect(loaded.publicKey).toBe(entry.public_key);
    expect((await loaded.signer.getPublicKey()).toString()).toBe(entry.public_key);
  });
  it("refuses mismatched identity, public key and conflicting secret fields without echoing them", async ({
    skip,
  }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const { input, entry, path } = await setup();
    for (const changed of [
      { ...entry, account_id: "other.testnet" },
      { ...entry, public_key: "ed25519:bad" },
      { ...entry, secret_key: "SECRET_SENTINEL" },
    ]) {
      await writeFile(path, JSON.stringify(changed));
      await expect(loadWatcherKey(input)).rejects.toThrow("Watcher key unavailable or invalid");
      await expect(loadWatcherKey(input)).rejects.not.toThrow("SECRET_SENTINEL");
    }
  });
  it("rejects symlinks without reading their target", async ({ skip }) => {
    if (process.platform === "win32")
      skip("Requires POSIX O_NOFOLLOW and symlink creation without Windows privileges.");
    const { input, entry, path } = await setup();
    const other = join(input.directory, "other.json");
    await writeFile(other, JSON.stringify(entry));
    await symlink(other, path);
    await expect(loadWatcherKey(input)).rejects.toThrow("Watcher key unavailable or invalid");
  });
  it("rejects oversized key files", async ({ skip }) => {
    if (process.platform === "win32") skip(POSIX_REQUIRED);
    const { input, path } = await setup();
    await writeFile(path, "x".repeat(16_385));
    await expect(loadWatcherKey(input)).rejects.toThrow("Watcher key unavailable or invalid");
  });
  it("rejects a network mismatch before loading a key", async () => {
    const input = {
      directory: "PRIVATE_DIRECTORY_SENTINEL",
      guardianId: "guardian.testnet",
      watcherAccountId: "watcher.testnet",
      network: "testnet" as const,
    };
    await expect(loadWatcherKey({ ...input, guardianId: "guardian.near" })).rejects.toThrow(
      "Invalid watcher key configuration",
    );
  });
});
