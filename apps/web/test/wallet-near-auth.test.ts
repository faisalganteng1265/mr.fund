import type { Auth0Client, IdToken } from "@auth0/auth0-spa-js";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthAccount } from "../src/wallet/auth-key";
import { createNearAuthAdapter } from "../src/wallet/near-auth";
import type { WalletConfig } from "../src/wallet/types";

const config: WalletConfig = {
  network: "testnet",
  rpcUrl: "https://rpc.example",
  auth: {
    clientId: "public-client",
    domain: "login.testnet.fast-auth.com",
    contractId: "fast-auth.testnet",
    mpcId: "v1.signer-prod.testnet",
  },
};
const publicKey = "ed25519:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const account = {
  accountId: "0101010101010101010101010101010101010101010101010101010101010101",
  publicKey,
};
function fixture(authenticated = true) {
  const order: string[] = [];
  const client = {
    checkSession: vi.fn(async () => {
      order.push("check");
    }),
    isAuthenticated: vi.fn(async () => authenticated),
    loginWithPopup: vi.fn(async () => {
      order.push("popup");
    }),
    getIdTokenClaims: vi.fn<() => Promise<IdToken | undefined>>(async () => ({
      __raw: "sdk-owned-token-must-not-escape",
      sub: "auth0|subject",
      email: "not-an-account@example.com",
    })),
    logout: vi.fn(async () => {
      authenticated = false;
    }),
  } satisfies Pick<
    Auth0Client,
    "checkSession" | "isAuthenticated" | "loginWithPopup" | "getIdTokenClaims" | "logout"
  >;
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const call = JSON.parse(String(init?.body));
    if (call.method === "status") return Response.json({ result: { chain_id: "testnet" } });
    const args = JSON.parse(atob(call.params.args_base64));
    // The identity must come from the SDK's validated ID-token subject, not email.
    if (args.path !== "jwt#https://login.testnet.fast-auth.com/#auth0|subject")
      throw new Error("Unexpected identity path");
    return Response.json({
      result: {
        block_height: 1,
        block_hash: "final-block",
        result: [...new TextEncoder().encode(JSON.stringify(publicKey))],
      },
    });
  });
  const adapter = createNearAuthAdapter(config, {
    client,
    resolveAccount: (cfg, sub) => resolveAuthAccount(cfg, sub, fetchImpl),
  });
  return { adapter, client, fetchImpl, order };
}

describe("hosted NEAR Auth lifecycle", () => {
  it("passively restores authenticated identity as an implicit account only", async () => {
    const f = fixture();
    await expect(f.adapter.restore()).resolves.toEqual([account]);
    expect(f.adapter.method).toBe("near-auth");
    expect(f.order).toEqual(["check"]);
    expect(f.client.loginWithPopup).not.toHaveBeenCalled();
  });
  it("does not derive or prompt when passive restore has no session", async () => {
    const f = fixture(false);
    await expect(f.adapter.restore()).resolves.toEqual([]);
    expect(f.order).toEqual(["check"]);
    expect(f.client.getIdTokenClaims).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("checks provider authentication after passive session refresh completes", async () => {
    const f = fixture(false);
    f.client.checkSession.mockImplementationOnce(async () => {
      f.client.isAuthenticated.mockResolvedValue(true);
    });
    await expect(f.adapter.restore()).resolves.toEqual([account]);
  });
  it("opens the popup synchronously from login and maps subject, never email", async () => {
    const f = fixture();
    const result = f.adapter.login();
    expect(f.order).toEqual(["popup"]);
    await expect(result).resolves.toEqual([account]);
    expect(f.client.checkSession).not.toHaveBeenCalled();
  });
  it("cancellation rejects without deriving or fabricating a session", async () => {
    const f = fixture(false);
    f.client.loginWithPopup.mockRejectedValueOnce(new Error("Popup cancelled"));
    await expect(f.adapter.login()).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await expect(f.adapter.restore()).resolves.toEqual([]);
  });
  it("refuses popup completion without an authenticated session", async () => {
    const f = fixture(false);
    await expect(f.adapter.login()).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([undefined, { __raw: "private", email: "email-only@example.com" }])(
    "refuses missing ID-token subject instead of using profile email",
    async (claims) => {
      const f = fixture();
      f.client.getIdTokenClaims.mockResolvedValueOnce(claims);
      await expect(f.adapter.login()).rejects.toThrow();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("key-resolution failure rejects and a retry must derive again", async () => {
    const f = fixture();
    f.fetchImpl.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(f.adapter.login()).rejects.toThrow();
    await expect(f.adapter.restore()).resolves.toEqual([account]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("session-check failure is not converted into an authenticated account", async () => {
    const f = fixture();
    f.client.checkSession.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(f.adapter.restore()).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("logs out locally without redirect, leaving restore disconnected", async () => {
    const f = fixture();
    await f.adapter.login();
    await f.adapter.logout();
    expect(f.client.logout).toHaveBeenCalledWith({ openUrl: false });
    await expect(f.adapter.restore()).resolves.toEqual([]);
  });
  it("does not claim logout succeeded if the SDK rejects", async () => {
    const f = fixture();
    f.client.logout.mockRejectedValueOnce(new Error("Logout failed"));
    await expect(f.adapter.logout()).rejects.toThrow();
  });
  it("requires Auth configuration even with injected dependencies", () => {
    const f = fixture();
    expect(() => createNearAuthAdapter({ ...config, auth: null }, { client: f.client })).toThrow();
  });
});
