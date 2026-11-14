import type * as Fs from "node:fs";
import { lstat, open } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadWatcherKey, WatcherKeyPlatformError } from "../src/runtime/keys";
import {
  createOperatorJournal,
  OperatorJournalPlatformError,
} from "../src/runtime/operator-journal";

// Isolate a runtime without O_NOFOLLOW; neither the host constants nor process.platform changes.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined } };
});
vi.mock("node:fs/promises", () => ({ lstat: vi.fn(), open: vi.fn() }));

const authority = {
  network: "testnet" as const,
  guardianId: "guardian.testnet",
  watcherAccountId: "watcher.testnet",
  allowance: 1n,
};

describe("watcher missing O_NOFOLLOW capability", () => {
  it("refuses journal construction before any filesystem operation even on Linux", () => {
    expect(() =>
      createOperatorJournal("PRIVATE_DIRECTORY_SENTINEL", authority, { platform: "linux" }),
    ).toThrow(OperatorJournalPlatformError);
    expect(lstat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses key loading before opening a file even on Linux", async () => {
    await expect(
      loadWatcherKey(
        { directory: "PRIVATE_DIRECTORY_SENTINEL", ...authority },
        { platform: "linux" },
      ),
    ).rejects.toThrow(WatcherKeyPlatformError);
    expect(open).not.toHaveBeenCalled();
  });
});
