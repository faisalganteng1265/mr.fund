import type { OpeningToolContext, ProposalContext, ToolContext } from "@mrfund/agent";
import type { OpeningFee } from "@mrfund/engine";
import { createGuardianClient } from "@mrfund/guardian-client";
import { type RheaClient, readOpenPositionContext } from "@mrfund/rhea";
import type { FeeSchedule } from "@mrfund/shared";
import { networkAccount, readPositionConfig } from "../position/config";
import { createPositionLoader } from "../position/loader";
import { record } from "../transport";
import type { ChatRequest } from "./handler";

export interface ChatConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  lendingId: string;
  factoryId?: string;
  fees?: FeeSchedule;
  /** Plain-wallet opening; absent keeps the opening tools at `not_available`. */
  opening?: OpeningConfig;
}
/** The pair, the default target and the approved fee (`kind: "none"` is an explicit decision). */
export interface OpeningConfig {
  collateralTokenId: string;
  debtTokenId: string;
  defaultTargetBps: number;
  /** Absent: the draft tools answer `fee_policy_missing`. */
  fee?: { tokenId: string; recipientId: string; amountAtomic: bigint };
}
function atomic(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,38})$/.test(value))
    throw new Error("Chat context unavailable");
  const amount = BigInt(value);
  if (amount > (1n << 128n) - 1n) throw new Error("Chat context unavailable");
  return amount;
}

/** No public/browser env fallbacks: a missing deployment choice is not a network choice. */
export function readChatConfig(
  env: Readonly<Record<string, string | undefined>>,
): ChatConfig | null {
  try {
    const readConfig = readPositionConfig(env);
    if (!readConfig) return null;
    const { network } = readConfig;
    const factoryId = env.GUARDIAN_FACTORY_ID || undefined;
    if (factoryId && !networkAccount(factoryId, network)) return null;
    const config: ChatConfig = {
      ...readConfig,
      ...(factoryId ? { factoryId } : {}),
    };
    const tokenId = env.FEE_TOKEN_ID;
    const recipientId = env.FEE_RECIPIENT_ID;
    const activationFee = env.FEE_ACTIVATION_ATOMIC;
    const actionFee = env.FEE_ACTION_ATOMIC;
    const executionFee = env.FEE_EXECUTION_ATOMIC;
    // An incomplete pricing decision disables proposals, not honest public position reads.
    if (tokenId && recipientId && activationFee && actionFee && executionFee) {
      if (!networkAccount(tokenId, network) || !networkAccount(recipientId, network)) return null;
      config.fees = {
        tokenId,
        recipientId,
        activationFee: atomic(activationFee),
        actionFee: atomic(actionFee),
        executionFee: atomic(executionFee),
      };
    }
    const collateralTokenId = env.OPENING_COLLATERAL_TOKEN_ID;
    const debtTokenId = env.OPENING_DEBT_TOKEN_ID;
    const feeAtomic = env.OPENING_FEE_ATOMIC;
    // An incomplete opening choice disables the opening tools only, like the fee schedule above.
    if (collateralTokenId && debtTokenId && collateralTokenId !== debtTokenId) {
      if (!networkAccount(collateralTokenId, network) || !networkAccount(debtTokenId, network))
        return null;
      const targetPercent = env.OPENING_DEFAULT_TARGET_BPS ?? "15000";
      if (!/^[1-9][0-9]{4}$/.test(targetPercent)) return null; // 10 000 < bps <= 99 999
      const opening: OpeningConfig = {
        collateralTokenId,
        debtTokenId,
        defaultTargetBps: Number(targetPercent),
      };
      if (opening.defaultTargetBps <= 10_000) return null;
      if (feeAtomic !== undefined && config.fees)
        opening.fee = {
          tokenId: config.fees.tokenId,
          recipientId: config.fees.recipientId,
          amountAtomic: atomic(feeAtomic),
        };
      config.opening = opening;
    }
    return config;
  } catch {
    return null;
  }
}

const isRegistered = async (client: RheaClient, tokenId: string, accountId: string) => {
  const r = await client.view(tokenId, "storage_balance_of", { account_id: accountId });
  if (!r.ok) throw new Error();
  if (r.value.data === null) return false;
  if (!record(r.value.data)) throw new Error();
  return atomic(r.value.data.total) > 0n;
};

/** Reads the opening inputs on demand; throws on any bad reply (the dispatcher then refuses). */
async function readOpening(
  config: ChatConfig,
  opening: OpeningConfig,
  client: RheaClient,
  accountId: string,
): Promise<OpeningToolContext> {
  const read = await readOpenPositionContext(
    client,
    { network: config.network, lendingId: config.lendingId },
    accountId,
    { collateralTokenId: opening.collateralTokenId, debtTokenId: opening.debtTokenId },
  );
  if (!read.ok) throw new Error();
  const out: OpeningToolContext = {
    context: read.value,
    feeRecipientRegistered: true,
    defaultTargetBps: opening.defaultTargetBps,
  };
  const f = opening.fee;
  if (f === undefined) return out;
  let fee: OpeningFee = { kind: "none" };
  if (f.amountAtomic > 0n) {
    fee = {
      kind: "fee",
      line: {
        label: "Mr.Fund fee",
        amount: f.amountAtomic,
        tokenId: f.tokenId,
        recipientId: f.recipientId,
        when: "In the same signed batch as this step",
      },
    };
    out.feeRecipientRegistered = await isRegistered(client, f.tokenId, f.recipientId);
    if (!out.feeRecipientRegistered) {
      const bounds = await client.view(f.tokenId, "storage_balance_bounds", {});
      if (!bounds.ok || !record(bounds.value.data)) throw new Error();
      out.storageDepositYocto = atomic(bounds.value.data.min);
      if (out.storageDepositYocto === 0n) throw new Error();
    }
  }
  out.fee = fee;
  return out;
}

/** Read-only, request-scoped clients: every nested adapter request inherits the same deadline. */
export function createContextLoader(config: ChatConfig, fetchImpl: typeof fetch = fetch) {
  return async (input: ChatRequest, signal: AbortSignal): Promise<ToolContext> => {
    try {
      const { snapshot, client, boundFetch } = await createPositionLoader(
        config,
        fetchImpl,
        false,
      )(input.accountId, signal);
      const context: ToolContext = { snapshot, nowMs: Date.now() };
      if (config.factoryId) {
        // Actual repository ABI: get_guardian, not an invented get_latest_guardian method.
        const lookup = await client.view(config.factoryId, "get_guardian", {
          owner_id: input.accountId,
        });
        if (!lookup.ok) throw new Error();
        const guardianId = lookup.value.data;
        if (
          guardianId !== null &&
          (typeof guardianId !== "string" ||
            !networkAccount(guardianId, config.network) ||
            !guardianId.endsWith(`.${config.factoryId}`))
        )
          throw new Error();
        if (input.guardianId !== undefined && input.guardianId !== guardianId) throw new Error();
        if (typeof guardianId === "string")
          context.guardian = {
            client: createGuardianClient(config.rpcUrl, boundFetch),
            target: { network: config.network, guardianId },
          };
      } else if (input.guardianId !== undefined) throw new Error();
      if (config.fees && context.snapshot.assets[config.fees.tokenId]) {
        // Proposal prerequisites are optional: a missing token/version view never fabricates fees.
        try {
          // These views do not depend on one another. Keep validation before publishing a proposal.
          const [version, balances, registration] = await Promise.all([
            client.view(config.lendingId, "get_version", {}),
            Promise.all(
              Object.keys(context.snapshot.assets).map(
                async (tokenId) =>
                  [
                    tokenId,
                    await client.view(tokenId, "ft_balance_of", { account_id: input.accountId }),
                  ] as const,
              ),
            ),
            client.view(config.fees.tokenId, "storage_balance_of", {
              account_id: config.fees.recipientId,
            }),
          ]);
          if (!version.ok || !["0.11.0", "0.16.2"].includes(String(version.value.data)))
            throw new Error();
          const walletBalances: Record<string, bigint> = Object.create(null);
          for (const [tokenId, balance] of balances) {
            if (!balance.ok) throw new Error();
            walletBalances[tokenId] = atomic(balance.value.data);
          }
          if (!registration.ok) throw new Error();
          let registered = false;
          if (registration.value.data !== null) {
            if (!record(registration.value.data)) throw new Error();
            const total = atomic(registration.value.data.total);
            const available = atomic(registration.value.data.available);
            if (available > total) throw new Error();
            registered = total > 0n;
          }
          const proposal: ProposalContext = {
            walletBalances,
            fees: config.fees,
            lendingId: config.lendingId,
            lendingVersion: String(version.value.data),
            feeRecipientRegistered: registered,
          };
          if (!registered) {
            const bounds = await client.view(config.fees.tokenId, "storage_balance_bounds", {});
            if (!bounds.ok || !record(bounds.value.data)) throw new Error();
            proposal.storageDepositYocto = atomic(bounds.value.data.min);
            if (proposal.storageDepositYocto === 0n) throw new Error();
          }
          context.proposal = proposal;
        } catch {
          signal.throwIfAborted();
          // Public position tools remain available; propose_card returns its typed not_available.
        }
      }
      const opening = config.opening;
      if (opening)
        context.openingLoader = async () => {
          signal.throwIfAborted();
          return readOpening(config, opening, client, input.accountId);
        };
      signal.throwIfAborted();
      context.nowMs = Date.now();
      return context;
    } catch {
      throw new Error("Chat context unavailable");
    }
  };
}
