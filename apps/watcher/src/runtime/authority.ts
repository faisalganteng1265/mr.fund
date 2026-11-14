import type { GuardianTarget } from "@mrfund/guardian-client";
import { err, type Result } from "@mrfund/shared";
import { type VerifiedAuthority, verifyAuthority } from "../core/authority";
import type { StartupEvidence, WatcherReads } from "../core/types";

interface AccessKeyReader {
  viewNodeStatus(): Promise<{ chain_id: string }>;
  viewAccessKey(args: {
    accountId: string;
    publicKey: string;
    finalityQuery: { finality: "final" };
  }): Promise<{ nonce: bigint; permission: unknown }>;
}

/** Only a verified scoped key can reach the signer; a nonce alone cannot prove a clean restart. */
export async function inspectWatcherAuthority(input: {
  target: GuardianTarget;
  watcherAccountId: string;
  publicKey: string;
  provider: AccessKeyReader;
  reads: WatcherReads;
}): Promise<
  Result<{ authority: VerifiedAuthority; nonce: bigint; startup: StartupEvidence }, string>
> {
  try {
    const [nodeStatus, accessKey, guardian] = await Promise.all([
      input.provider.viewNodeStatus(),
      input.provider.viewAccessKey({
        accountId: input.watcherAccountId,
        publicKey: input.publicKey,
        finalityQuery: { finality: "final" },
      }),
      input.reads.guardian(input.target),
    ]);
    if (!guardian.ok || typeof accessKey.nonce !== "bigint" || accessKey.nonce < 0n)
      return err("authority_unavailable");
    const result = verifyAuthority({
      network: input.target.network,
      rpcChainId: nodeStatus.chain_id,
      watcherAccountId: input.watcherAccountId,
      guardian: guardian.value,
      accessKey,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        authority: result.value,
        nonce: accessKey.nonce,
        startup: {
          kind: "uncertain",
          detail: "recent signed requests cannot be established from nonce alone",
        },
      },
    };
  } catch {
    return err("authority_unavailable");
  }
}
