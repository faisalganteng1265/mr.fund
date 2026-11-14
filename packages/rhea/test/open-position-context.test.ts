import { maxBorrow } from "@mrfund/engine";
import { describe, expect, it } from "vitest";
import { createRheaClient } from "../src/client";
import {
  parseAccountDebtShares,
  parseAssetPools,
  readOpenPositionContext,
} from "../src/open-position-context";

const LENDING = "contract.1689937928.burrow.testnet";
const WRAP = "wrap.testnet";
const REF = "ref.fakes.testnet";
const ME = "alice.testnet";
const NOW_BLOCK = { height: 100, hash: "BLOCKHASH100" };
const cfg = { network: "testnet" as const, lendingId: LENDING };
const req = { collateralTokenId: WRAP, debtTokenId: REF };

const asset = (tokenId: string, over: Record<string, unknown> = {}) => ({
  token_id: tokenId,
  supplied: { shares: "1000", balance: "1100" },
  borrowed: { shares: "400", balance: "450" },
  margin_debt: { shares: "0", balance: "0" },
  margin_pending_debt: "0",
  reserved: "20",
  prot_fee: "5",
  config: {
    extra_decimals: 0,
    volatility_ratio: tokenId === WRAP ? 6000 : 7500,
    can_borrow: tokenId === REF,
    can_use_as_collateral: true,
  },
  supply_apr: "0.01",
  borrow_apr: "0.02",
  ...over,
});

type Views = Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
function chain(
  over: Views = {},
  blockFor: (key: string) => { height: number; hash: string } = () => NOW_BLOCK,
) {
  const views: Views = {
    [`${LENDING}/get_config`]: {
      enable_pyth_oracle: true,
      pyth_oracle_account_id: "pyth-oracle.testnet",
      pyth_price_valid_duration_sec: 60,
    },
    [`${LENDING}/get_version`]: "0.11.0",
    [`${LENDING}/get_all_token_pyth_infos`]: {
      [WRAP]: {
        decimals: 24,
        fraction_digits: 0,
        price_identifier: "11".repeat(32),
        extra_call: null,
        default_price: { multiplier: "960", decimals: 26 },
      },
      [REF]: {
        decimals: 18,
        fraction_digits: 0,
        price_identifier: "22".repeat(32),
        extra_call: null,
        default_price: { multiplier: "250", decimals: 20 },
      },
    },
    [`${LENDING}/get_assets_paged_detailed`]: [asset(WRAP), asset(REF)],
    [`${LENDING}/get_account`]: {
      account_id: ME,
      supplied: [],
      collateral: [{ token_id: WRAP, balance: "1000000000000000000000000", shares: "9" }],
      borrowed: [],
    },
    [`${LENDING}/get_asset`]: (a: Record<string, unknown>) => asset(String(a.token_id)),
    [`${WRAP}/ft_metadata`]: { symbol: "wNEAR", decimals: 24 },
    [`${REF}/ft_metadata`]: { symbol: "REF", decimals: 18 },
    [`${WRAP}/ft_balance_of`]: "5000000000000000000000000",
    [`${REF}/ft_balance_of`]: "7",
    [`${LENDING}/storage_balance_bounds`]: { min: "100000000000000000000000", max: null },
    [`${WRAP}/storage_balance_bounds`]: { min: "1250000000000000000000", max: null },
    [`${REF}/storage_balance_bounds`]: {
      min: "1250000000000000000000",
      max: "1250000000000000000000",
    },
    [`${LENDING}/storage_balance_of`]: { total: "100000000000000000000000", available: "0" },
    [`${WRAP}/storage_balance_of`]: { total: "1250000000000000000000", available: "0" },
    [`${REF}/storage_balance_of`]: null,
    ...over,
  };
  return createRheaClient("https://rpc.example", async (_url, init) => {
    const p = JSON.parse(String(init?.body)).params;
    const key = `${p.account_id}/${p.method_name}`;
    if (!(key in views)) throw new Error(`unrecorded ${key}`);
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString());
    const v = views[key];
    const data = typeof v === "function" ? (v as (a: Record<string, unknown>) => unknown)(args) : v;
    const b = blockFor(key);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "view",
        result: {
          block_height: b.height,
          block_hash: b.hash,
          result: [...Buffer.from(JSON.stringify(data))],
        },
      }),
    );
  });
}

describe("readOpenPositionContext", () => {
  it("reads the snapshot, pools, shares, liquidity, registrations and wallet on one block", async () => {
    const r = await readOpenPositionContext(chain(), cfg, ME, req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value;
    expect(c.lendingVersion).toBe("0.11.0");
    expect(c.blockHeight).toBe(100);
    expect(c.blockHash).toBe("BLOCKHASH100");
    expect(c.oracleValidityMs).toBe(60_000);
    expect(c.snapshot.collateral).toEqual([{ tokenId: WRAP, internal: 10n ** 24n }]);
    expect(c.snapshot.assets[REF]?.canBorrow).toBe(true);
    expect(c.snapshot.prices[REF]?.source).toBe("default_price");
    expect(c.pools).toEqual({
      borrowedShares: 400n,
      borrowedBalance: 450n,
      suppliedShares: 1000n,
      suppliedBalance: 1100n,
    });
    expect(c.accountBorrowedShares).toBe(0n);
    // supplied 1100 + reserved 20 + prot_fee 5 - borrowed 450 = 675
    expect(c.availableInternal).toBe(675n);
    expect(c.walletCollateralBalance).toBe(5n * 10n ** 24n);
    expect(c.walletDebtBalance).toBe(7n);
    expect(c.registrations.lending).toEqual({ registered: true, minimumYocto: 10n ** 23n });
    expect(c.registrations.debtToken).toEqual({
      registered: false,
      minimumYocto: 1_250n * 10n ** 18n,
    });
  });

  it("feeds the engine directly: 1 wNEAR at 9.6 USD x 60% against REF at 2.5 USD x 75%", async () => {
    const r = await readOpenPositionContext(chain(), cfg, ME, req);
    if (!r.ok) throw new Error("fixture");
    const { walletCollateralBalance: _w, registrations: _r, blockHash: _h, ...rest } = r.value;
    const m = maxBorrow({ ...rest, targetBps: 15_000 }, r.value.snapshot.readAtMs);
    // Adjusted collateral 5.76 USD; at 150% adjusted debt <= 3.84 USD = 3.84 x 0.75 / 2.5 REF
    // = 1.152 REF, but the pool only has 675 internal units of liquidity.
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.value.value).toMatchObject({ maxAtomic: 675n, bindingLimit: "liquidity" });
  });

  it("subtracts margin debt and pending margin debt from liquidity and honours a borrowed limit", () => {
    const withMargin = parseAssetPools(
      asset(REF, { margin_debt: { shares: "5", balance: "30" }, margin_pending_debt: "7" }),
      REF,
    );
    // 1100 + 20 + 5 - 450 - 30 - 7 = 638
    expect(withMargin.availableInternal).toBe(638n);
    const limited = parseAssetPools(
      asset(REF, {
        config: { ...asset(REF).config, borrowed_limit: "500" },
      }),
      REF,
    );
    // used 450 leaves 50 under the limit, below the 675 of liquidity.
    expect(limited.availableInternal).toBe(50n);
    const over = parseAssetPools(
      asset(REF, { config: { ...asset(REF).config, borrowed_limit: "100" } }),
      REF,
    );
    expect(over.availableInternal).toBe(0n);
    // A pool whose borrowed balance exceeds what is supplied has no liquidity, not a negative one.
    expect(
      parseAssetPools(asset(REF, { borrowed: { shares: "400", balance: "5000" } }), REF)
        .availableInternal,
    ).toBe(0n);
  });

  it("reads debt shares from the raw account, and zero when there is no line", () => {
    const acct = {
      account_id: ME,
      supplied: [],
      collateral: [],
      borrowed: [{ token_id: REF, balance: "10", shares: "9" }],
    };
    expect(parseAccountDebtShares(acct, ME, REF)).toBe(9n);
    expect(parseAccountDebtShares(acct, ME, WRAP)).toBe(0n);
    expect(parseAccountDebtShares(null, ME, REF)).toBe(0n);
    expect(() => parseAccountDebtShares({ ...acct, account_id: "bob.testnet" }, ME, REF)).toThrow();
    expect(() =>
      parseAccountDebtShares({ ...acct, borrowed: [acct.borrowed[0], acct.borrowed[0]] }, ME, REF),
    ).toThrow();
  });

  it.each([
    ["a leading-zero number", { supplied: { shares: "01", balance: "1100" } }],
    ["a fractional number", { reserved: "1.5" }],
    ["a JSON number", { prot_fee: 5 }],
    ["a value above u128", { reserved: `${2n ** 128n}` }],
    ["another token's asset", { token_id: WRAP }],
  ])("refuses %s in get_asset", async (_name, patch) => {
    const r = await readOpenPositionContext(
      chain({ [`${LENDING}/get_asset`]: () => asset(REF, patch) }),
      cfg,
      ME,
      req,
    );
    expect(r).toMatchObject({ ok: false, error: { kind: "bad_response" } });
  });

  it.each([
    ["an unparsable version", { [`${LENDING}/get_version`]: "v0.11" }],
    ["a non-string version", { [`${LENDING}/get_version`]: 11 }],
    [
      "an account for someone else",
      {
        [`${LENDING}/get_account`]: {
          account_id: "bob.testnet",
          supplied: [],
          collateral: [],
          borrowed: [],
        },
      },
    ],
    ["a non-canonical wallet balance", { [`${WRAP}/ft_balance_of`]: "5.0" }],
    ["a non-canonical debt-token balance", { [`${REF}/ft_balance_of`]: "7.5" }],
    ["a malformed storage minimum", { [`${REF}/storage_balance_bounds`]: { min: "x" } }],
  ])("refuses %s", async (_name, patch) => {
    const r = await readOpenPositionContext(chain(patch), cfg, ME, req);
    expect(r).toMatchObject({ ok: false, error: { kind: "bad_response" } });
  });

  it("refuses a pair token Rhea does not list, the same token twice, and bad ids", async () => {
    const unlisted = await readOpenPositionContext(chain(), cfg, ME, {
      ...req,
      debtTokenId: "dai.testnet",
    });
    expect(unlisted.ok).toBe(false);
    expect(
      (
        await readOpenPositionContext(chain(), cfg, ME, {
          collateralTokenId: WRAP,
          debtTokenId: WRAP,
        })
      ).ok,
    ).toBe(false);
    expect((await readOpenPositionContext(chain(), cfg, "Not An Account", req)).ok).toBe(false);
  });

  it("refuses a reply from another block", async () => {
    const r = await readOpenPositionContext(
      chain({}, (key) => (key.endsWith("/get_asset") ? { height: 101, hash: "OTHER" } : NOW_BLOCK)),
      cfg,
      ME,
      req,
    );
    expect(r).toMatchObject({ ok: false, error: { kind: "bad_response" } });
  });

  it("reports a failing RPC as unavailable, not as bad data", async () => {
    const client = createRheaClient(
      "https://rpc.example",
      async () => new Response("no", { status: 503 }),
    );
    const r = await readOpenPositionContext(client, cfg, ME, req);
    expect(r).toMatchObject({ ok: false, error: { kind: "rpc_unavailable" } });
  });

  it("an unregistered account reads as an empty position with registrations false", async () => {
    const r = await readOpenPositionContext(
      chain({
        [`${LENDING}/get_account`]: null,
        [`${LENDING}/storage_balance_of`]: null,
        [`${WRAP}/storage_balance_of`]: null,
      }),
      cfg,
      ME,
      req,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.snapshot.collateral).toEqual([]);
    expect(r.value.accountBorrowedShares).toBe(0n);
    expect(Object.values(r.value.registrations).map((x) => x.registered)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
