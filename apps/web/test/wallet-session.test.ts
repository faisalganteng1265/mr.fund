import { describe, expect, it, vi } from "vitest";
import { createWalletSession } from "../src/wallet/session";
import type { AuthAdapter, AuthMethod, ConnectedAccount } from "../src/wallet/types";

function harness() {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  };
  let accounts: readonly ConnectedAccount[] = [
    { accountId: "alice.testnet" },
    { accountId: "bob.testnet" },
  ];
  let signedIn = false;
  let loginFailure = false;
  const listeners = new Set<() => void>();
  const adapter = (method: AuthMethod): AuthAdapter => ({
    method,
    async restore() {
      return signedIn ? accounts : [];
    },
    async login() {
      if (loginFailure) throw new Error("private-token-secret");
      signedIn = true;
      return accounts;
    },
    async logout() {
      signedIn = false;
    },
    subscribe(changed) {
      listeners.add(changed);
      return () => {
        listeners.delete(changed);
      };
    },
  });
  const adapters = { "near-auth": adapter("near-auth"), "near-connect": adapter("near-connect") };
  return {
    storage,
    saved,
    adapters,
    fail: () => {
      loginFailure = true;
    },
    replace(next: readonly ConnectedAccount[]) {
      accounts = next;
      for (const changed of listeners) changed();
    },
  };
}

describe("one active browser account", () => {
  it("never authenticates a forged stored account hint", async () => {
    const h = harness();
    h.saved.set(
      "mrfund:wallet:v1:testnet",
      JSON.stringify({ method: "near-connect", accountId: "attacker.testnet" }),
    );
    const session = createWalletSession("testnet", h.adapters, h.storage);
    await session.restore();
    expect(session.getSnapshot().session).toBeNull();
    expect(session.getSnapshot().status).toBe("disconnected");
  });
  it("restricts selection to provider accounts and changes the account-scoped context key", async () => {
    const h = harness();
    const session = createWalletSession("testnet", h.adapters, h.storage);
    await session.login("near-connect");
    const first = session.getSnapshot().session;
    expect(first?.accountId).toBe("alice.testnet");
    expect(() => session.selectAccount("attacker.testnet")).toThrow();
    expect(session.getSnapshot().session?.accountId).toBe("alice.testnet");
    session.selectAccount("bob.testnet");
    expect(session.getSnapshot().session?.contextKey).not.toBe(first?.contextKey);
    const restored = createWalletSession("testnet", h.adapters, h.storage);
    await restored.restore();
    expect(restored.getSnapshot().session?.accountId).toBe("bob.testnet");
    await restored.logout();
    expect(restored.getSnapshot().session).toBeNull();
    expect(h.saved.size).toBe(0);
    session.dispose();
    restored.dispose();
  });
  it("does not restore the other network or accept an unavailable login method", async () => {
    const h = harness();
    await h.adapters["near-connect"].login();
    h.saved.set(
      "mrfund:wallet:v1:mainnet",
      JSON.stringify({ method: "near-connect", accountId: "alice.testnet" }),
    );
    const session = createWalletSession(
      "testnet",
      { "near-connect": h.adapters["near-connect"] },
      h.storage,
    );
    await session.restore();
    expect(session.getSnapshot().session).toBeNull();
    await session.login("near-auth");
    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().session).toBeNull();
  });
  it("clears the prior account before a failed method change and sanitizes provider errors", async () => {
    const h = harness();
    const session = createWalletSession("testnet", h.adapters, h.storage);
    await session.login("near-connect");
    h.fail();
    await session.login("near-auth");
    expect(session.getSnapshot().session).toBeNull();
    expect(JSON.stringify(session.getSnapshot())).not.toContain("private-token-secret");
    expect(session.getSnapshot().error).toMatch(/try|sign.in/i);
  });
  it("rechecks external account changes rather than retaining the previous identity", async () => {
    const h = harness();
    const session = createWalletSession("testnet", h.adapters, h.storage);
    await session.login("near-connect");
    h.replace([{ accountId: "carol.testnet" }]);
    expect(session.getSnapshot().session).toBeNull();
    await vi.waitFor(() => expect(session.getSnapshot().session?.accountId).toBe("carol.testnet"));
    session.dispose();
  });
});
