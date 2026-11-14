# Rhea protocol evidence — 2026-11-07

Scope: `verify-rhea-protocol-evidence` (P1.2/P1.4/P2.7/P4.2). All transactions described here are **local sandbox** execution with new state, test tokens, zero asset rates and **Simulated** prices. No public transaction, wallet proof or current public price availability is established.

## Encoding inventory

[V] `fixtures/encodings.json` has five independently asserted syntax vectors. Rust `contracts/tests/tests/encodings.rs` compares receiver, method, complete UTF-8 argument bytes (including nested message key order) and deposit with the existing TypeScript assertions:

| Vector | TypeScript consumer | Rust execution evidence |
| --- | --- | --- |
| `wallet_repay_legacy` | `packages/rhea/test/repay.test.ts` | Raw independent encoder sends `Execute/Repay.max_amount` to imported 0.11.0 |
| `wallet_repay` | `packages/rhea/test/repay.test.ts` | Raw independent encoder sends `OnlyRepay` to imported 0.16.2 |
| `guardian_repay` | `packages/guardian-client/test/repay.test.ts` | Syntax parity only; current Guardian receiver does **not** implement this message |
| `fee_transfer` | `packages/shared/test/nep141.test.ts` | Encoded transfer changes a registered sandbox recipient's balance by the requested amount |
| `storage_deposit` | `packages/shared/test/nep141.test.ts` | Encoded registration permits subsequent real sandbox token transfers |

The Rust encoder lives only in test support and is used by the sandbox harness; it is not a new production signer/builder. Unknown lending versions refuse; legacy internal multiplication is checked, including zero/38/39 extra-decimal and u128 boundaries. No fallback retry occurs. A deliberately altered transfer deposit (2 instead of 1 yocto) made the parity test fail; the mutation was restored. Initial encoder tests failed before implementation.

Permission boundary: existing owner-gated probe calls retain 1 yocto and configured targets; raw requests are signed only by generated local test accounts. Invariant E1 preserves version and atomic/internal unit boundaries. Negative evidence includes unsupported versions, overflow, changed-deposit mutation, foreign probe callers and forged callbacks. Byte equality alone does not prove a receiver implements a message, measured production gas, or public network compatibility today.

## Imported code provenance

[V] Sandbox checks each WASM against its recorded SHA-256 before deploying it. The artifacts used were downloaded on 2026-11-06:

| Source | Version | Source block | SHA-256 |
| --- | --- | --- | --- |
| Testnet | 0.11.0 | 276446382 | `60a433509ce1f3d5663073c6d55e23b3941599121320a29eaf9771c2843666de` |
| Mainnet | 0.16.2 | 223272972 | `4fd64e59a0466cf3392ff1914959c59c7c086ed82300571c6e8fc89d9f7dede1` |

Re-running preparation records a new source block/hash; compare the generated provenance rather than assuming these are current deployment observations. These hashes identify imported code, not a fork of live state.

## Repayment and health observations

[V] Both versions execute contract-owned partial repayment of 20,000,000 atomic units followed by full repayment of the remaining 30,000,000. The intermediate debt is exactly 30,000,000,000,000,000,000 internal units. Another account's debt is unchanged by those repayments. Each operation checks all failed receipts and post-state, not merely the immediate promise.

[V] For a separate wallet debt of 10,000,000,000,000,000,001 internal units, both supported messages accept 10,000,001 atomic units, clear debt and add exactly 999,999,999,999 internal units to supplied balance. Wallet spend and resolver-used amount agree. Excess is supplied, **not refunded**; accepted tokens do not all represent debt reduction.

[V] Eleven shared TS/Rust vectors cover ordinary balances, zero collateral, a subatomic debt increment, and ±1 internal debt unit around health 10000 and trigger 12000 bps. On each imported version, actual borrow calls accept debt 284,999,999,999,999,999,999 and 285,000,000,000,000,000,000, reject 285,000,000,000,000,000,001, and leave state unchanged on rejection. These observations test the protocol's risk boundary, not an exported scalar health view.

[V] A separate Simulated liquidation uses 100,000,000 collateral units at $3, collateral/debt ratios 6000/9500 and 200,000,000,000,000,000,000 internal debt. Engine and Rust probe health are 8550 bps. Imported 0.16.2 emits `old_discount = "0.0725"`; `(1 − 2 × discount) × 10000` gives 8550 bps (0 bps difference for this vector). Debt decreases by the requested 1 USDC, and collateral decreases by one atomic unit. The test restores price/collateral and the original debt before the dust repayment.

[V] Imported 0.11.0 emits a liquidation event **without** `old_discount`/`new_discount`. Its scalar health difference is therefore unobserved; its accepted/rejected borrow boundary and actual liquidation are independently checked. There is no fabricated health RPC. Generated `contracts/target/probes/health-evidence-{testnet,mainnet}.json` retain source provenance, pre-state, raw event and nullable observed health.

[I, independently tested source model] Published burrowland commit `2110c7047f2d72a9189abcbaad5eafb4e4a87f9e` uses 27-decimal fixed-point `from_balance_price`, `mul_ratio` and `div_ratio`. Flooring the ratio of its adjusted sums yields 14249 versus the engine's exact 14250 for the $5/200-USDC reference, and 8549 versus 8550 for the $3 case. The remaining listed vectors agree. This is a **published-source model**, not a numerical observation from deployed WASM. It differs from reconstructing health through the rounded liquidation discount. No >1-bp difference was observed in these bounded checks; no universal tolerance claim is made for arbitrary balances/assets.

Sources: [published fixed-point implementation](https://github.com/ref-finance/burrowland/blob/2110c7047f2d72a9189abcbaad5eafb4e4a87f9e/contracts/contract/src/big_decimal.rs), [position sums](https://github.com/ref-finance/burrowland/blob/2110c7047f2d72a9189abcbaad5eafb4e4a87f9e/contracts/contract/src/position.rs), [liquidation math](https://github.com/ref-finance/burrowland/blob/2110c7047f2d72a9189abcbaad5eafb4e4a87f9e/contracts/contract/src/actions.rs). Read 2026-11-07; source version does not establish deployed-version identity.

## Public comparison and remaining gates

[V] An attempt to open `https://rhea.finance/` for public display comparison on 2026-11-07 returned `The browser access host is unavailable`. No aligned account/display/block observation or screenshot was obtained. P1.4 UI parity remains unchecked; earlier public account `brianphan01.near` recordings are not substituted as UI evidence. No login or signing was attempted.

P1.2/P1.4 full parity acceptance, P2.7 complete Guardian/factory invariants, production builder gas and P4.5 live wallet proof remain separate. D18/D19/D27/B7 are unchanged. P4.2 is kept open for its remaining integration/gas scope despite completion of the Rust syntax parity subtask.

## Reproduction

With the existing prepared artifacts, run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm contracts:test -- --nocapture`, and `cargo clippy --manifest-path contracts/Cargo.toml --all-targets -- -D warnings`. A fresh clone first runs `pnpm contracts:probe:prepare`; preparation downloads public code/config and builds local WASM, without public chain writes. Run summaries are recorded in BUILD-PLAN with this change.
