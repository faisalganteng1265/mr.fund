import { isValidAccountId } from "@mrfund/shared";
import { base58 } from "@scure/base";
import type { ConnectedAccount } from "./types";

/** Project provider results to public account context; never preserve identity tokens. */
export function validateAccounts(value: unknown): readonly ConnectedAccount[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid account list");
  const ids = new Set<string>();
  return value.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid account");
    const account = candidate as Record<string, unknown>;
    if (
      typeof account.accountId !== "string" ||
      !isValidAccountId(account.accountId) ||
      ids.has(account.accountId)
    ) {
      throw new Error("Invalid or duplicate account");
    }
    ids.add(account.accountId);
    if (account.publicKey === undefined) return { accountId: account.accountId };
    if (typeof account.publicKey !== "string" || account.publicKey.length > 100)
      throw new Error("Invalid public key");
    const [curve, encoded] = account.publicKey.split(":");
    const length = curve === "ed25519" ? 32 : curve === "secp256k1" ? 64 : 0;
    if (
      !length ||
      !encoded ||
      account.publicKey.split(":").length !== 2 ||
      base58.decode(encoded).length !== length
    ) {
      throw new Error("Invalid public key");
    }
    return { accountId: account.accountId, publicKey: account.publicKey };
  });
}
