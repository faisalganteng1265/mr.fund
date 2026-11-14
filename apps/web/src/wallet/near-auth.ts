"use client";

import { Auth0Client } from "@auth0/auth0-spa-js";
import { validateAccounts } from "./accounts";
import { resolveAuthAccount } from "./auth-key";
import type { AuthAdapter, ConnectedAccount, WalletConfig } from "./types";

export interface NearAuthDependencies {
  readonly client?: Pick<
    Auth0Client,
    "checkSession" | "isAuthenticated" | "loginWithPopup" | "getIdTokenClaims" | "logout"
  >;
  readonly resolveAccount?: typeof resolveAuthAccount;
}

/** SDK-owned identity validation; no tokens, signers or user profile leave this adapter. */
export function createNearAuthAdapter(
  config: WalletConfig,
  dependencies: NearAuthDependencies = {},
): AuthAdapter {
  const auth = config.auth;
  if (!auth) throw new Error("NEAR Auth is not configured");
  // Construct once before a button gesture; login never waits for SDK initialization.
  const client =
    dependencies.client ??
    new Auth0Client({
      domain: auth.domain,
      clientId: auth.clientId,
      cacheLocation: "memory",
      useRefreshTokens: false,
      authorizationParams: { redirect_uri: window.location.origin, scope: "openid" },
    });
  const resolveAccount = dependencies.resolveAccount ?? resolveAuthAccount;
  async function accounts(): Promise<readonly ConnectedAccount[]> {
    // getIdTokenClaims reads claims validated by the official SDK, not an email/profile.
    const claims = await client.getIdTokenClaims();
    if (typeof claims?.sub !== "string" || !claims.sub)
      throw new Error("NEAR Auth identity unavailable");
    return validateAccounts([await resolveAccount(config, claims.sub)]);
  }
  return {
    method: "near-auth",
    async restore() {
      try {
        await client.checkSession();
        return (await client.isAuthenticated()) ? await accounts() : [];
      } catch {
        throw new Error("NEAR Auth session could not be restored");
      }
    },
    async login() {
      try {
        // Called immediately from the user's button; no passive check before popup.
        await client.loginWithPopup();
        if (!(await client.isAuthenticated())) throw new Error("NEAR Auth session missing");
        return await accounts();
      } catch {
        throw new Error("NEAR Auth sign-in did not complete");
      }
    },
    async logout() {
      try {
        // Local SDK cache/cookie cleanup only; this does not end hosted/global SSO.
        await client.logout({ openUrl: false });
      } catch {
        throw new Error("NEAR Auth sign-out did not complete");
      }
    },
  };
}
