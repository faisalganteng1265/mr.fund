import type { KeyPairString } from "near-api-js";
import { describe, expect, it } from "vitest";
import { sandboxOverLimit } from "../src/sandbox/operator";

describe("sandbox operator isolation", () => {
  it.each([
    "https://rpc.testnet.near.org/",
    "http://localhost:3030/",
    "http://127.0.0.2:3030/",
    "http://127.0.0.1:3030/path",
    "http://user:pass@127.0.0.1:3030/",
    "http://127.0.0.1:3030/?proxy=1",
  ])("refuses non-isolated RPC URL %s before loading a key", async (rpcUrl) => {
    await expect(
      sandboxOverLimit({
        rpcUrl,
        guardianId: "guardian.test.near",
        watcherId: "watcher.test.near",
        secretKey: "invalid" as KeyPairString,
        journalDirectory: "/unused",
      }),
    ).rejects.toThrow("Sandbox loopback endpoint required");
  });
});
