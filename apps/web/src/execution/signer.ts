import { type VerifiedGuardian, wasGuardianVerified } from "../guardian/verify";
import { type VerifiedOpening, wasOpeningVerified } from "./open-position-verify";
import { type VerifiedRepay, wasVerified } from "./verify";

/** The wallet surface the signer needs; matches `@hot-labs/near-connect` 0.12.0. */
export interface SigningWallet {
  signAndSendTransactions(params: {
    network: "testnet" | "mainnet";
    signerId: string;
    transactions: {
      receiverId: string;
      actions: {
        type: "FunctionCall";
        params: { methodName: string; args: object; gas: string; deposit: string };
      }[];
    }[];
  }): Promise<unknown>;
}

/**
 * Connect-only signing capability (task 2.1). It signs only a `VerifiedRepay` issued by
 * `verifyCardPayload`, a `VerifiedGuardian` issued by `verifyGuardianPayload` or a
 * `VerifiedOpening` issued by `verifyOpeningPayload` for this exact account and network (one
 * signing path for all three, E1, G-UI-1 and OP-1; each result is looked up only in its own
 * issuer's registry, so one kind can never pass as another), sets `signerId` and `network`
 * explicitly, and hands back the wallet's result unmodified. NEAR Auth has no signer at all.
 */
export interface TransactionSigner {
  readonly accountId: string;
  readonly network: "testnet" | "mainnet";
  signAndSend(verified: VerifiedRepay | VerifiedGuardian | VerifiedOpening): Promise<unknown>;
}

export function createTransactionSigner(
  session: {
    method: "near-auth" | "near-connect";
    accountId: string;
    network: "testnet" | "mainnet";
  },
  wallet: () => Promise<SigningWallet>,
): TransactionSigner | null {
  if (session.method !== "near-connect") return null;
  const { accountId, network } = session;
  return Object.freeze({
    accountId,
    network,
    async signAndSend(verified: VerifiedRepay | VerifiedGuardian | VerifiedOpening) {
      const issued =
        "stage" in verified
          ? wasOpeningVerified(verified)
          : "intent" in verified
            ? wasGuardianVerified(verified)
            : wasVerified(verified);
      if (!issued) throw new Error("Only a verified payload can be signed.");
      if (verified.signerId !== accountId)
        throw new Error("The payload was verified for another account.");
      if (verified.network !== network)
        throw new Error("The payload was verified for another network.");
      const w = await wallet();
      return w.signAndSendTransactions({
        network,
        signerId: accountId,
        transactions: verified.transactions.map((t) => ({
          receiverId: t.receiverId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: t.methodName,
                args: t.args,
                gas: t.gas.toString(),
                deposit: t.deposit.toString(),
              },
            },
          ],
        })),
      });
    },
  });
}
