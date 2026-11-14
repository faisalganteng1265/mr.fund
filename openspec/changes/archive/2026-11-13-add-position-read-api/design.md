## Context

[V, repository inspection, 2026-11-09] The existing chat composition is `POST` → `createContextLoader` (`apps/web/src/server/chat/context.ts`) → `createRheaClient`/`readPosition` (`packages/rhea/src/client.ts`, `snapshot.ts`) → `ToolContext.snapshot`. `getPosition`, the private runner for `get_position` in `packages/agent/src/tools.ts`, calls `healthBps`, `liquidationPrice`, `outstandingDebtAtomic` and shared `toAtomic`. `dispatch` is awaitable. The route must not invoke chat or scrape its localized facts to obtain structured data.

[V] `PositionSnapshot` (`packages/shared/src/snapshot.ts`) contains Rhea internal balances, network/lending/account ids, block height, read-start time, assets and prices. `readPosition` pins reads to its config block hash; a null `get_account` becomes empty balances through `parseAccount` (`packages/rhea/src/views.ts`). `AdapterError` currently distinguishes only `rpc_unavailable` and `bad_response`. The chat loader deliberately collapses errors, so it cannot directly provide the route's taxonomy.

[V, BUILD-PLAN P0.3/P1.4 and INTEGRATIONS recipes 2–4, recorded 2026-11-06] Deployed testnet reports 0.11.0; mainnet reports 0.16.2. Testnet oracle prices were null. Imported-WASM repayment behavior differs: bounded `Execute/Repay.max_amount` on 0.11.0 versus `OnlyRepay` on 0.16.2. These facts do not prove all read views work today; no transaction encoding is needed by this route.

## Decisions

All decisions below are [I, proposed implementation], not observed runtime behavior.

### Shared read boundary, not a second adapter

Extract a small public-position loader and server configuration/network helpers from chat context into `apps/web/src/server/position/` (new path). Both handlers use this loader, which preserves typed adapter failures internally; chat may still map them to its existing generic unavailable result. Read only `NEAR_NETWORK_ID`, `NEAR_RPC_URL`, `RHEA_LENDING_ID`; absent/invalid explicit HTTPS/network/account configuration refuses, never falls back to browser env, fixtures or another RPC/network. Position reads must not require fees, factory lookup, model configuration or credentials. Keep chat's optional Guardian/proposal enrichment in chat context.

Reuse `createRheaClient(rpcUrl, boundFetch)` and `readPosition(client, {network, lendingId}, accountId)` unchanged as the protocol read/calculation foundation. Reuse `isValidAccountId` from shared. Extract the existing server network predicate rather than importing watcher authority into web; include `testnet` itself as a testnet root, `.testnet` descendants as testnet, and canonical 64-lowercase-hex implicit ids as network-neutral. Other syntactically valid ids use mainnet under this app's existing convention. Syntax/suffix does not prove an account exists or identify an implicit account's network.

Verify RPC `status.result.chain_id` equals configured network before position views. The shared loader wraps the client's view boundary to retain `get_config`'s anchor hash/height; read `get_version` at that same hash and verify returned hash/height against the snapshot. Accept only explicitly supported 0.11.0/0.16.2 versions, without inferring compatibility from published source 0.15.7 or retrying another schema. Existing `readPosition` remains the only config/account/assets/metadata/price parser; the wrapper records provenance, not a parallel snapshot implementation. Unknown versions produce a dedicated error; malformed/mixed-block data is untrusted. This anchor metadata is currently not returned by `PositionSnapshot` and is new loader orchestration, not an existing API claim.

Clarification [I, approved by lead, 2026-11-10]: the shared loader accepts an explicit provenance-verification option. The independent position endpoint always enables strict pinned-version verification. Chat keeps its existing snapshot path and optional proposal-version behavior: a missing/unsupported version disables proposals rather than public position tools. This preserves existing chat behavior without weakening the position endpoint's guarantees.

Reuse `healthBps(snapshot, nowMs, opts)`, `liquidationPrice(snapshot, tokenId, nowMs, opts)` and `outstandingDebtAtomic(snapshot, tokenId)` from engine, plus shared `toAtomic` and `usdPerWholeToken`. Do not reimplement formulas or convert money through Number. Use the engine's exported `MAX_DATA_AGE_MS` (120000 today) as the default and pass one validated positive integer server override to all freshness-aware calculations. Reject unknown asset metadata before debt conversion: `outstandingDebtAtomic` returns zero for unknown tokens, which is not proof of zero debt. Preserve engine assumptions and input records, including capped health and supplied-not-collateral exclusions. Do not alter existing tool presentation just to serve HTTP.

### Request and response contracts

GET accepts exactly one `accountId` and one `networkId` query parameter; POST accepts precisely `{accountId, networkId}` JSON and no query parameters. `networkId` is `testnet` or `mainnet` and must equal server configuration; it never selects an RPC or contract. Reject duplicates, extra keys, malformed account syntax, URLs, uppercase ids and wrong-network named ids before RPC. No ownership assertion, login/session token or wallet signature is required for public reads.

HTTP 200 JSON is the following structural contract; type names describe the new wire schema, not existing exported TypeScript types:

```text
{ ok: true, provenance: "live", accountId, networkId,
  source: { protocol: "rhea", lendingId, lendingVersion, blockHash, blockHeight },
  readAtMs, computedAtMs, dataAgeMs, maxDataAgeMs,
  supplied: BalanceView[], collateral: BalanceView[], debt: BalanceView[],
  health: { kind: "value", bps: integer } | { kind: "no_debt" },
  liquidationPrices: LiquidationView[], inputs: string-map, assumptions: string[] }
BalanceView = { tokenId, symbol, decimals, extraDecimals,
  internal: canonical-integer-string, atomic: canonical-integer-string,
  atomicRounding: "down" | "up",
  supplyAprBps: integer, borrowAprBps: integer,
  price: { multiplier: canonical-integer-string, decimals: integer,
    source: "oracle" | "default_price", publishTimeMs: integer | null } | null }
LiquidationView = { tokenId, kind: "price", multiplier: canonical-integer-string,
  decimals: integer, usdPerWholeToken: decimal-string }
  | { tokenId, kind: "no_debt" | "covered_by_other_collateral" }
```

`blockHeight`, bps, decimals and millisecond fields are validated non-negative safe integers, not monetary floats. `readAtMs` is the adapter's read-start time; `computedAtMs` is response computation time. `dataAgeMs` includes snapshot age and the oldest relevant engine-priced input; per-price publish times preserve additional context. Source network is the top-level `networkId`. Atomic balances refer to lending supply/collateral/debt, not wallet FT balances. Supply/collateral floor through `toAtomic`; debt ceils through `outstandingDebtAtomic`. Exact `internal` strings plus `extraDecimals` retain subatomic dust; rounded atomic fields do not pretend that dust disappeared. No combined amount across unlike tokens is returned. Money/price strings are unlocalized and never exponential notation. APR fields preserve D30.

Calculate health on internal units, flooring health as the engine does; never recompute it from rounded atomic strings. Compute one liquidation price for each positive collateral line when debt exists, with engine rounding up. Engine multiplier zero means covered by other collateral, not a zero market quote. No debt means `health.kind = no_debt`, not infinity. Derived liquidation prices have no oracle publish-time claim; source price timestamps remain in balance data. Preserve the limitation that a token simultaneously collateral and debt is shocked only on its collateral leg by the current engine, and disclose that assumption. Missing prices required for health/liquidation refuse; unpriced non-collateral supply can have `price: null` without inventing advice about it. Every positive line must have validated token metadata.

`provenance: live` means obtained from current public RPC reads, not that a protocol `default_price` tracks the market. Keep `default_price` visible and retain the engine's fixed-price assumptions. The browser consumer must compare response `networkId` and accountId with its current wallet context and discard mismatches or superseded requests. This change supplies the contract and server test; actual UI wiring is outside scope.

### Stable errors and bounded work

All errors return `{ok:false, error:{code,message}, networkId}` with configured network or null when configuration is invalid. Messages are static, actionable English; no raw exception, stack, RPC body, URL credential or environment value appears. No success balances/health accompany an error.

| HTTP | Stable code | Meaning |
| --- | --- | --- |
| 400 | `invalid_input` | Bad JSON/selectors, duplicate/unknown fields or account syntax |
| 409 | `network_mismatch` | Client network/account suffix disagrees, or RPC chain disagrees with server |
| 404 | `no_position` | Null/unregistered account or all lending balances zero; not proof the NEAR account does not exist |
| 503 | `rpc_unavailable` | Transport/HTTP/status unavailable, not a guessed empty position |
| 503 | `configuration_unavailable` | Missing or invalid explicit server read configuration |
| 422 | `stale_data` | Engine stale snapshot/price; no current risk numbers |
| 502 | `untrusted_data` | Malformed/mixed-block/future data, missing required price, unsupported asset/schema |
| 422 | `unsupported_protocol_version` | Well-formed get_version outside explicit supported set |
| 504 | `timeout` | Whole-request or downstream RPC deadline exceeded |
| 499 | `cancelled` | Caller disconnected, if a response can still be delivered |
| 413 | `request_too_large` | Streamed POST body exceeds 1024 bytes or query string exceeds 512 UTF-8 bytes |
| 415 | `invalid_content_type` | POST is not application/json |
| 429 | `rate_limited` | Admission quota/capacity exhausted; include Retry-After |
| 405 | `method_not_allowed` | Any method other than GET/POST; Allow: GET, POST |

Preserve causal cancellation/timeout classification around the adapter, whose current transport errors otherwise collapse. Set a 15000 ms total deadline starting before body parsing; combine request cancellation with adapter 10000 ms timeouts via the existing `bindTurnFetch`, and reuse `readBoundedBody` in `apps/web/src/server/chat/transport.ts`. Extract helpers into shared server code only when both handlers need them, migrating both imports and removing old exports. Abort fetch and response-body consumption, clean timers/listeners and issue no subsequent views after cancellation. Retain the helper's 4 MiB RPC-response ceiling. No hidden retries, fallback provider or background refresh.

Use `Cache-Control: no-store` for every response and fetch, with no cross-request cache/TTL. Reason: low hackathon traffic does not justify serving balances from an unseen cache, and post-repay reads must observe a new final snapshot. Request-local block pinning is not a cache; expose actual data age rather than implying freshness from HTTP success.

Use bounded in-memory admission following chat's existing pattern, extracting only shared mechanics: 30 requests per 60000 ms for transport/IP and separately for network/account, at most 4096 combined buckets, expired buckets evicted, capacity exhaustion refuses rather than evicts active limits. Charge the transport bucket before parsing and account bucket after validation. Trust proxy IP only with the existing server-configured authenticated edge-header contract; otherwise use one conservative direct-client bucket, never raw X-Forwarded-For. Local-process limits are not global anti-abuse protection; multi-replica deployment requires an edge quota. Tests inject clock, fetch and admission identity, without public RPC.

## Permission boundary and invariants

This route is public read-only, including Guardian account reads explicitly selected as accountId; it does not discover ownership or authorize actions. It has no signer, transaction sender, model, key loader or factory mutation. Guardian I1–I10 remain unchanged. Proposed read invariant R1: source/network/account match the validated request; R2: every successful numeric field comes from validated snapshot/engine data; R3: missing/stale/untrusted data cannot become a live success. Negative tests cover attempted request-supplied RPC/contract overrides, foreign-network accounts, RPC chain mismatch, signing imports and fixture fallback. This does not guarantee ownership, independent Rhea UI parity, RPC/oracle truth, future liquidation behavior or successful repayment.

## Risks / limits

- [U] Current public testnet prices and a public account with a usable priced position; local fixtures cannot satisfy live smoke. A historical mainnet public account is only a candidate, not current evidence.
- [V] P1.2/P1.4 public UI parity remains open. HTTP integration cannot claim an independent numerical comparison.
- [V] Current shared snapshot has no block hash/version, and chat errors are generic; the shared loader must retain provenance/errors rather than infer them.
- [V] ARCHITECTURE's responsibilities table mentions a short cache, while its adapter section and implementation say no cache. This proposal explicitly chooses no cross-request cache; an owning-doc reconciliation must be reviewed, not silently described as existing behavior.
- [I] Named-account suffix rules are an application convention; implicit ids require explicit network and actual RPC chain verification. No suffix heuristic proves account presence.
