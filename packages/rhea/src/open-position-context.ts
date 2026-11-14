/**
 * Block-pinned inputs for a plain-wallet opening quote (`add-chat-open-position` 2.1): the
 * existing position snapshot plus what only the opening needs, namely the debt token's pool
 * totals and the account's debt shares, how much liquidity a borrow may draw, the wallet's
 * collateral balance, the observed lending version, and registration state with storage minimums.
 *
 * Every view runs at the anchor block of `get_config` (the shared `pinnedContext` rejects any
 * reply from another block), every number must be a canonical u128 decimal string, and the shape
 * of `OpenPositionContext` matches the engine's `OpenPositionInput` minus the chosen target, so
 * the app passes it straight to `maxBorrow`. Nothing is inferred from APRs, versions or displayed
 * amounts. This package does not import the engine; the structural types below are identical.
 *
 * Liquidity follows Burrow's `Asset::available_amount` (ref-finance/burrowland@2110c704):
 * `supplied + reserved + prot_fee - borrowed - margin_debt - margin_pending_debt`, further capped
 * by any configured `borrowed_limit` headroom. Pool views return balances already interest-updated
 * to the queried block; the transaction lands a few blocks later and moves them by about one part
 * in 10^9 per second, which is why the engine's results are estimates.
 *
 * Does not guarantee: that the state is unchanged when a transaction lands, that a registration
 * stays valid, or that Rhea accepts the action; the verifier and outcome reader re-check.
 */
import { isValidAccountId, ok, type PositionSnapshot, type Result } from "@mrfund/shared";
import { type AdapterError, badResponse, type RheaClient } from "./client";
import { failure, type NetworkConfig, pinnedContext } from "./snapshot";
import { account, atomic, parseAccount, record } from "./views";

export interface PoolTotals {
  borrowedShares: bigint;
  borrowedBalance: bigint;
  suppliedShares: bigint;
  suppliedBalance: bigint;
}

export interface Registration {
  registered: boolean;
  /** NEP-145 `storage_balance_bounds().min`, yoctoNEAR. */
  minimumYocto: bigint;
}

export interface OpenPositionRequest {
  collateralTokenId: string;
  debtTokenId: string;
}

export interface OpenPositionContext {
  snapshot: PositionSnapshot;
  collateralTokenId: string;
  debtTokenId: string;
  /** Observed `get_version` of the lending contract at the anchor block. */
  lendingVersion: string;
  pools: PoolTotals;
  accountBorrowedShares: bigint;
  /** Rhea internal units the borrow may draw. */
  availableInternal: bigint;
  oracleValidityMs: number;
  /** Collateral tokens in the wallet, token atomic units. */
  walletCollateralBalance: bigint;
  /** Debt tokens in the wallet, token atomic units; corroboration only, never proof of delivery. */
  walletDebtBalance: bigint;
  registrations: {
    lending: Registration;
    collateralToken: Registration;
    debtToken: Registration;
  };
  blockHeight: number;
  blockHash: string;
}

interface AssetPools {
  pools: PoolTotals;
  availableInternal: bigint;
}

function pool(v: unknown): { shares: bigint; balance: bigint } {
  const r = record(v);
  return { shares: atomic(r.shares), balance: atomic(r.balance) };
}

/** Raw `get_asset`: pool totals and the liquidity a borrow may draw. Unknown shapes throw. */
export function parseAssetPools(v: unknown, tokenId: string): AssetPools {
  const r = record(v);
  if (r.token_id !== tokenId) throw new Error("Asset mismatch");
  const supplied = pool(r.supplied);
  const borrowed = pool(r.borrowed);
  const margin = r.margin_debt === undefined ? 0n : pool(r.margin_debt).balance;
  const pendingMargin = r.margin_pending_debt === undefined ? 0n : atomic(r.margin_pending_debt);
  const reserved = atomic(r.reserved);
  const protFee = atomic(r.prot_fee);
  const used = borrowed.balance + margin + pendingMargin;
  const gross = supplied.balance + reserved + protFee;
  let available = gross > used ? gross - used : 0n;
  const config = record(r.config);
  if (config.borrowed_limit !== undefined && config.borrowed_limit !== null) {
    const limit = atomic(config.borrowed_limit);
    const headroom = limit > used ? limit - used : 0n;
    if (headroom < available) available = headroom;
  }
  return {
    pools: {
      borrowedShares: borrowed.shares,
      borrowedBalance: borrowed.balance,
      suppliedShares: supplied.shares,
      suppliedBalance: supplied.balance,
    },
    availableInternal: available,
  };
}

/** Debt shares one account holds in one token; 0 when the account or the line does not exist. */
export function parseAccountDebtShares(v: unknown, accountId: string, tokenId: string): bigint {
  if (v === null) return 0n;
  const r = record(v);
  if (r.account_id !== accountId) throw new Error("Account mismatch");
  if (!Array.isArray(r.borrowed)) throw new Error("Invalid borrowed lines");
  let shares: bigint | null = null;
  for (const line of r.borrowed) {
    const x = record(line);
    if (account(x.token_id) !== tokenId) continue;
    if (shares !== null) throw new Error("Duplicate borrowed line");
    shares = atomic(x.shares);
  }
  return shares ?? 0n;
}

const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export async function readOpenPositionContext(
  client: RheaClient,
  cfg: NetworkConfig,
  accountId: string,
  req: OpenPositionRequest,
): Promise<Result<OpenPositionContext, AdapterError>> {
  try {
    if (![accountId, req.collateralTokenId, req.debtTokenId].every((id) => isValidAccountId(id)))
      return badResponse("Invalid account or token id");
    if (req.collateralTokenId === req.debtTokenId)
      return badResponse("Collateral and debt must be different tokens");
    const c = await pinnedContext(client, cfg);
    const version = await c.view(cfg.lendingId, "get_version", {});
    if (typeof version !== "string" || !VERSION.test(version))
      return badResponse("Invalid lending version");

    const raw = await c.view(cfg.lendingId, "get_account", { account_id: accountId });
    const balances = parseAccount(raw, accountId);
    const held = [...balances.supplied, ...balances.collateral, ...balances.borrowed].map(
      (b) => b.tokenId,
    );
    const loaded = await c.load([...new Set([...held, req.collateralTokenId, req.debtTokenId])]);
    for (const id of [req.collateralTokenId, req.debtTokenId])
      if (!loaded.assets[id]) return badResponse(`Unsupported asset ${id}`);

    const debtPools = parseAssetPools(
      await c.view(cfg.lendingId, "get_asset", { token_id: req.debtTokenId }),
      req.debtTokenId,
    );
    const storage = async (contractId: string): Promise<Registration> => {
      const bounds = record(await c.view(contractId, "storage_balance_bounds", {}));
      const mine = await c.view(contractId, "storage_balance_of", { account_id: accountId });
      if (mine !== null) record(mine);
      return { registered: mine !== null, minimumYocto: atomic(bounds.min) };
    };
    const walletCollateralBalance = atomic(
      await c.view(req.collateralTokenId, "ft_balance_of", { account_id: accountId }),
    );
    const walletDebtBalance = atomic(
      await c.view(req.debtTokenId, "ft_balance_of", { account_id: accountId }),
    );
    const snapshot: PositionSnapshot = {
      ...c.base,
      accountId,
      ...balances,
      assets: loaded.assets,
      prices: loaded.prices,
    };
    return ok({
      snapshot,
      collateralTokenId: req.collateralTokenId,
      debtTokenId: req.debtTokenId,
      lendingVersion: version,
      pools: debtPools.pools,
      accountBorrowedShares: parseAccountDebtShares(raw, accountId, req.debtTokenId),
      availableInternal: debtPools.availableInternal,
      oracleValidityMs: c.oracleValidityMs,
      walletCollateralBalance,
      walletDebtBalance,
      registrations: {
        lending: await storage(cfg.lendingId),
        collateralToken: await storage(req.collateralTokenId),
        debtToken: await storage(req.debtTokenId),
      },
      blockHeight: c.base.blockHeight,
      blockHash: c.blockHash,
    });
  } catch (e) {
    return failure(e);
  }
}
