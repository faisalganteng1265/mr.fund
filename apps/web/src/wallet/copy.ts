import type { WalletState } from "./session";
import type { AuthMethod, NearNetwork } from "./types";

export const METHOD_LABEL: Record<AuthMethod, string> = {
  "near-auth": "NEAR Auth",
  "near-connect": "NEAR Connect",
};

/** What the account can do, derived from the login method, never from model text. */
export function capabilityLine(method: AuthMethod): string {
  return method === "near-auth"
    ? "Read and chat only. Signing is not available for this account yet."
    : "Read and chat. Your wallet asks you to sign only when you approve a specific action.";
}

/** Plain status line for every controller state; null when nothing needs saying. */
export function statusLine(state: WalletState, network: NearNetwork | null): string | null {
  switch (state.status) {
    case "checking":
      return "Checking your wallet…";
    case "connecting":
      return "Waiting for you to finish signing in…";
    case "signing-out":
      return "Signing out on this device…";
    case "error":
      if (state.error?.includes("sign-out was not confirmed"))
        return "This device is signed out; the provider session may remain. Close its window to end it there.";
      if (network && state.error?.startsWith("Sign-in was not completed"))
        return `${state.error} The account must be on ${network}.`;
      return state.error ?? "Wallet sign-in is unavailable.";
    default:
      return null;
  }
}
