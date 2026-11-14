import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountMatchesNetwork,
  constrainedRequester,
  parseRequestOutcome,
  REQUEST_METHOD,
  type RepayCall,
  verifyAuthority,
} from "../src/core/authority";
import { GUARDIAN, guardian, NOW, WATCHER } from "./fixture";

const key = (permission: unknown) => ({ nonce: 5, permission, block_height: 1, block_hash: "b" });
const exact = key({
  FunctionCall: {
    allowance: "250000000000000000000000",
    receiver_id: GUARDIAN,
    method_names: [REQUEST_METHOD],
  },
});
const input = (over: Partial<Parameters<typeof verifyAuthority>[0]> = {}) => ({
  network: "testnet" as const,
  rpcChainId: "testnet",
  watcherAccountId: WATCHER,
  guardian: guardian(NOW),
  accessKey: exact,
  ...over,
});

describe("verifyAuthority: refuses anything broader than one Guardian method", () => {
  it("accepts a finite function-call key for request_repay on this Guardian only", () => {
    const r = verifyAuthority(input());
    expect(r).toEqual({
      ok: true,
      value: {
        network: "testnet",
        watcherAccountId: WATCHER,
        guardianId: GUARDIAN,
        allowance: 250_000_000_000_000_000_000_000n,
      },
    });
  });

  it.each([
    ["full-access key", key("FullAccess"), "full_access_key"],
    [
      "empty method list (any method)",
      key({ FunctionCall: { allowance: "1", receiver_id: GUARDIAN, method_names: [] } }),
      "broad_method_list",
    ],
    [
      "an extra owner method",
      key({
        FunctionCall: {
          allowance: "1",
          receiver_id: GUARDIAN,
          method_names: [REQUEST_METHOD, "set_policy"],
        },
      }),
      "broad_method_list",
    ],
    [
      "another receiver",
      key({
        FunctionCall: {
          allowance: "1",
          receiver_id: "other.testnet",
          method_names: [REQUEST_METHOD],
        },
      }),
      "wrong_receiver",
    ],
    [
      "unlimited allowance",
      key({
        FunctionCall: { allowance: null, receiver_id: GUARDIAN, method_names: [REQUEST_METHOD] },
      }),
      "unbounded_allowance",
    ],
    ["a malformed view", { permission: { FunctionCall: null } }, "access_key_unreadable"],
    ["no view", null, "access_key_unreadable"],
  ])("refuses %s", (_name, accessKey, reason) => {
    expect(verifyAuthority(input({ accessKey }))).toEqual({ ok: false, error: reason });
  });

  it("refuses a wrong network before looking at the key", () => {
    expect(verifyAuthority(input({ rpcChainId: "mainnet" }))).toEqual({
      ok: false,
      error: "rpc_network_mismatch",
    });
    expect(verifyAuthority(input({ guardian: guardian(NOW, { network: "mainnet" }) }))).toEqual({
      ok: false,
      error: "guardian_network_mismatch",
    });
    expect(
      verifyAuthority(input({ network: "mainnet", rpcChainId: "mainnet", accessKey: "x" })),
    ).toMatchObject({ ok: false });
    expect(verifyAuthority(input({ watcherAccountId: "watcher.near" }))).toEqual({
      ok: false,
      error: "account_network_mismatch",
    });
  });

  it("refuses a key whose account is not this Guardian's watcher", () => {
    expect(verifyAuthority(input({ watcherAccountId: "intruder.testnet" }))).toEqual({
      ok: false,
      error: "not_guardian_watcher",
    });
  });

  it("matches account suffixes to networks", () => {
    expect(accountMatchesNetwork("a.testnet", "testnet")).toBe(true);
    expect(accountMatchesNetwork("a.near", "testnet")).toBe(false);
    expect(accountMatchesNetwork("a.testnet", "mainnet")).toBe(false);
    expect(accountMatchesNetwork("a".repeat(64).replace(/a/g, "f"), "mainnet")).toBe(true);
  });
});

describe("constrainedRequester: one method, zero deposit", () => {
  const authority = {
    network: "testnet" as const,
    watcherAccountId: WATCHER,
    guardianId: GUARDIAN,
    allowance: 1n,
  };
  function port() {
    const calls: RepayCall[] = [];
    return {
      calls,
      port: {
        async send(call: RepayCall) {
          calls.push(call);
          return { kind: "pending" as const, hash: "h" };
        },
        async lookup() {
          return { kind: "unknown" as const };
        },
      },
    };
  }

  it("builds only request_repay to the verified Guardian with no deposit", async () => {
    const p = port();
    const r = constrainedRequester(authority, p.port);
    await r.requestRepay(42n);
    expect(p.calls).toEqual([
      {
        signerId: WATCHER,
        receiverId: GUARDIAN,
        methodName: "request_repay",
        args: { amount: "42" },
        gas: 300_000_000_000_000n,
        deposit: 0n,
      },
    ]);
    expect(Object.keys(r).sort()).toEqual(["guardianId", "lookup", "network", "requestRepay"]);
  });

  it.each([0n, -1n, 1n << 128n])("refuses amount %s before signing", async (amount) => {
    const p = port();
    expect(await constrainedRequester(authority, p.port).requestRepay(amount)).toEqual({
      kind: "refused",
      reason: "invalid_amount",
    });
    expect(p.calls).toEqual([]);
  });
});

describe("parseRequestOutcome", () => {
  it("parses every contract outcome", () => {
    expect(parseRequestOutcome({ outcome: "rejected", op_id: "3", reason: "cooldown" })).toEqual({
      outcome: "rejected",
      opId: 3n,
      reason: "cooldown",
    });
    expect(parseRequestOutcome({ outcome: "executed", op_id: "4", used: "90", fee: "1" })).toEqual({
      outcome: "executed",
      opId: 4n,
      used: 90n,
      fee: 1n,
    });
    expect(parseRequestOutcome({ outcome: "unresolved", op_id: "5" })).toEqual({
      outcome: "unresolved",
      opId: 5n,
    });
  });

  it.each([
    null,
    { outcome: "executed", op_id: "1", used: "-1", fee: "0" },
    { outcome: "executed", op_id: 1, used: "1", fee: "0" },
    { outcome: "rejected", op_id: "1", reason: "because" },
    { outcome: "settled", op_id: "1" },
    { outcome: "failed", op_id: "18446744073709551616" },
  ])("rejects malformed %j", (value) => {
    expect(parseRequestOutcome(value)).toBeNull();
  });
});

describe("watcher import boundary", () => {
  const dir = join(__dirname, "../src");
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts"));
  const source = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

  it("imports no agent or LLM code", () => {
    expect(files.length).toBeGreaterThan(0);
    const imports = source.match(/from\s+["'][^"']+["']/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.join("\n")).not.toMatch(/@mrfund\/agent|openai|anthropic|near-ai/i);
    const core = files
      .filter((file) => file.startsWith("core/"))
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    expect(core.match(/from\s+["'][^"']+["']/g)?.join("\n") ?? "").not.toMatch(
      /near-api-js|signer/i,
    );
  });

  it("names no owner method", () => {
    for (const method of [
      "set_policy",
      "pause",
      "resume",
      "deactivate",
      "withdraw",
      "rotate_watcher",
      "deposit_reserve",
      "borrow",
    ])
      expect(source).not.toMatch(new RegExp(`["'\`]${method}["'\`]`));
  });
});
