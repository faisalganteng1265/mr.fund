import {
  type AssetState,
  isValidAccountId,
  ok,
  type PositionSnapshot,
  type Price,
  type Result,
} from "@mrfund/shared";
import { type AdapterError, badResponse, type RheaClient, type ViewResult } from "./client";
import {
  type AssetView,
  account,
  atomic,
  integer,
  parseAccount,
  parseAsset,
  parseAssets,
  parseOraclePrice,
  parsePythInfo,
  record,
} from "./views";

export interface NetworkConfig {
  network: "testnet" | "mainnet";
  lendingId: string;
}
export interface MarketSnapshot {
  network: "testnet" | "mainnet";
  lendingId: string;
  blockHeight: number;
  readAtMs: number;
  assets: Record<string, AssetState>;
  prices: Record<string, Price>;
  unsupportedTokenIds: string[];
}

/** Typed failure internally propagated without exposing provider data. */
class ReadFailure extends Error {
  constructor(readonly error: AdapterError) {
    super(error.detail);
  }
}
async function unwrap(result: Promise<Result<ViewResult, AdapterError>>): Promise<ViewResult> {
  const r = await result;
  if (!r.ok) throw new ReadFailure(r.error);
  return r.value;
}
export function failure(e: unknown): Result<never, AdapterError> {
  return e instanceof ReadFailure
    ? { ok: false, error: e.error }
    : badResponse("Invalid Rhea view data");
}

/** One pinned read context: every `view` is checked against the anchor block of `get_config`. */
export async function pinnedContext(client: RheaClient, cfg: NetworkConfig) {
  if (!["testnet", "mainnet"].includes(cfg.network) || !isValidAccountId(cfg.lendingId))
    throw new Error("Invalid network config");
  const readAtMs = Date.now();
  const anchor = await unwrap(client.view(cfg.lendingId, "get_config", {}));
  const view = async (contractId: string, method: string, args: unknown) => {
    const r = await unwrap(client.view(contractId, method, args, anchor.blockHash));
    if (r.blockHash !== anchor.blockHash || r.blockHeight !== anchor.blockHeight)
      throw new Error("Mixed blocks");
    return r.data;
  };
  const config = record(anchor.data);
  if (config.enable_pyth_oracle !== true) throw new Error("Unsupported oracle mode");
  const oracleId = account(config.pyth_oracle_account_id);
  const age = integer(config.pyth_price_valid_duration_sec, 3600);
  if (!age) throw new Error("Invalid price age");
  const infos = record(await view(cfg.lendingId, "get_all_token_pyth_infos", {}));
  const assets = new Map<string, AssetView>();
  // Pages are pinned to the same block; an upper bound prevents a broken RPC from looping forever.
  let finished = false;
  for (let from = 0; from < 1000; from += 20) {
    const page = parseAssets(
      await view(cfg.lendingId, "get_assets_paged_detailed", { from_index: from, limit: 20 }),
    );
    if (page.length > 20) throw new Error("Oversized assets page");
    for (const asset of page) {
      if (assets.has(asset.tokenId)) throw new Error("Duplicate asset");
      assets.set(asset.tokenId, asset);
    }
    if (page.length < 20) {
      finished = true;
      break;
    }
  }
  if (!finished) throw new Error("Asset pagination limit exceeded");
  const load = async (
    tokenIds: string[],
  ): Promise<Pick<MarketSnapshot, "assets" | "prices" | "unsupportedTokenIds">> => {
    const result: Pick<MarketSnapshot, "assets" | "prices" | "unsupportedTokenIds"> = {
      assets: Object.create(null) as Record<string, AssetState>,
      prices: Object.create(null) as Record<string, Price>,
      unsupportedTokenIds: [],
    };
    for (const tokenId of tokenIds) {
      const assetView = assets.get(tokenId);
      if (!assetView || !Object.hasOwn(infos, tokenId)) {
        result.unsupportedTokenIds.push(tokenId);
        continue;
      }
      const info = parsePythInfo(infos[tokenId]);
      const asset = parseAsset(assetView, await view(tokenId, "ft_metadata", {}));
      if (asset.token.decimals !== info.decimals) throw new Error("Token decimals mismatch");
      result.assets[tokenId] = asset;
      let price = info.defaultPrice;
      if (!price) {
        price = parseOraclePrice(
          await view(oracleId, "get_price_no_older_than", { price_id: info.priceId, age }),
          info,
        );
        if (price && info.extraCall) {
          const adjustment = atomic(await view(tokenId, info.extraCall, {}));
          if (adjustment === 0n) throw new Error("Invalid derivative price");
          price = { ...price, multiplier: (price.multiplier * adjustment) / 10n ** 24n };
        }
      }
      if (price && price.multiplier > 0n) result.prices[tokenId] = price;
    }
    return result;
  };
  return {
    view,
    load,
    blockHash: anchor.blockHash,
    /** The oracle's own validity window; Rhea refuses prices older than this. */
    oracleValidityMs: age * 1000,
    tokenIds: [...assets.keys()],
    base: {
      network: cfg.network,
      lendingId: cfg.lendingId,
      blockHeight: anchor.blockHeight,
      readAtMs,
    },
  };
}

/** Read the regular Rhea lending position. Balances remain in Rhea internal units. */
export async function readPosition(
  client: RheaClient,
  cfg: NetworkConfig,
  accountId: string,
): Promise<Result<PositionSnapshot, AdapterError>> {
  try {
    if (!isValidAccountId(accountId)) return badResponse("Invalid account id");
    const c = await pinnedContext(client, cfg);
    const balances = parseAccount(
      await c.view(cfg.lendingId, "get_account", { account_id: accountId }),
      accountId,
    );
    const tokenIds = [
      ...new Set(
        [...balances.supplied, ...balances.collateral, ...balances.borrowed].map((b) => b.tokenId),
      ),
    ];
    const { assets, prices } = await c.load(tokenIds);
    return ok({ ...c.base, accountId, ...balances, assets, prices });
  } catch (e) {
    return failure(e);
  }
}

export async function readMarket(
  client: RheaClient,
  cfg: NetworkConfig,
): Promise<Result<MarketSnapshot, AdapterError>> {
  try {
    const c = await pinnedContext(client, cfg);
    return ok({ ...c.base, ...(await c.load(c.tokenIds)) });
  } catch (e) {
    return failure(e);
  }
}
