# [EXTEND] Chat-driven plain-wallet opening design

## Status, scope and evidence

[I, design, 2026-11-13] This is a stretch specification only. Implement only after the core submission is complete; it does not reopen P0 scope, authorize a deployment or satisfy an existing BUILD-PLAN checkbox. Initial custody is the connected wallet's Rhea account, with one supported collateral token and one supported debt token. An existing position in that same pair must be included in sizing; additional pairs refuse rather than being ignored. Guardian-held opening is later, separate work. There is no automatic migration or repay-on-behalf.

Sources read for this design:

- `docs/PRD.md`: F1–F5, F2's current empty-position behavior, recommendation card contract, integer money and honesty rules.
- `docs/technical/ARCHITECTURE.md`: import rules, block-pinned reads, engine health formula and manual execution flow.
- `docs/technical/INTEGRATIONS.md`, recipes 3–4: dated Gate 1 plain-account cycle and price investigation.
- `docs/LESSONS.md`, 2026-11-11 share-rounding headline; `docs/technical/SMART-CONTRACT.md`, I1–I10 and promise-result discipline.
- Existing implementations: `packages/rhea/src/tx/repay.ts`, `views.ts`, `snapshot.ts`, `outcome*.ts`; `packages/engine/src/{health,sizing,card}.ts`; `packages/agent/src/{tools,numbers}.ts`; `apps/web/src/execution/{verify,signer,run,plan,live}.ts`.

[V, recorded public testnet evidence, 2026-11-11] Recipe 3 records the following, not an implemented chat flow:

| Observation | Design consequence |
| --- | --- |
| 0.5 wNEAR collateral deposited by the plain wallet | Deposit is a token `ft_transfer_call` to lending, with `Execute/IncreaseCollateral`, not a Guardian call. |
| USDC borrow rejected with `Missing usdc.fakes.testnet price`, block 277235533 | A listed/borrowable asset is not necessarily priced. Missing prices block executable borrowing. |
| Exact 0.5 REF Borrow + exact Withdraw reverted with `Not enough asset balance`, block 277235554 | Do not assume equal token amounts map to equal shares. |
| Borrow + amount-omitted Withdraw succeeded, block 277235624 | Use this verified shape only with the existing supplied-debt-balance guard below. Requested principal is not exact wallet delivery. |
| Resulting debt was 0.500000000435016701 REF; wallet received 0.5 REF minus 1 atomic unit | Quote rounded principal/debt separately from estimated delivery; receipt shows observed debt and actual token delivery. Never promise one-unit maximum dust or constant interest. |
| Both assets used `default_price` | Real testnet transactions, fixed prices, not market-linked protection. Hypothetical shocks/replays remain **Simulated**. |

Source discrepancies surfaced to the parent: recipe 3's earlier step 4 still sketches exact Withdraw, contradicted by its later explicit failure evidence; architecture/OpenSpec headers retain D19-open language although OPEN-DECISIONS records testnet selected on 2026-11-11. This extension records the discrepancies rather than silently rewriting those files. It relies on the dated observations and does not claim the fresh-price gate is complete. The live Guardian exact-withdraw issue is not fixed by a wallet builder.

## Flow and user commitments

1. Chat recognizes a desire to deposit collateral and borrow. Missing token/amount/target choices are collected in conversation or Adjust controls. Token ids, lending account, network, observed version, fees and snapshots come from validated application context, not model-selected contracts. The model can propose user intent, never manufacture values or payloads.
2. Deterministic code quotes a `wallet_collateral_deposit` card using the user's existing token balance (wNEAR is already wrapped). The card shows amount/token, wallet and lending ids, network, storage deposits, fee lines, risk and price availability. A combined opening preview may show estimated borrowing power, explicitly conditional on deposit settlement; it cannot authorize the later borrow.
3. The user reviews the app summary, then approves the wallet prompt. Observe prerequisite registrations and collateral deposit before claiming collateral applied. Deposit failure never triggers borrowing. If deposit applies and the user stops, collateral stays in Rhea; there is no automatic withdrawal or rollback.
4. Read a new FINAL-block position/market/wallet context. The engine calculates the maximum additional borrow and the selected amount's resulting health from the **observed** collateral. Produce a new `wallet_borrow` card; Adjust recomputes all numbers. Borrowing is not automatically selected at the maximum.
5. Revalidate the card and current inputs in the browser execution path, show the exact principal/estimated delivery/debt/health/fees, and request a separate Connect-wallet signature.
6. Reconcile all receipts and a new position plus wallet token balance. Show confirmed, failed, partially applied or unresolved results. A completed deposit followed by rejected/cancelled borrow is shown as deposit applied, borrow not confirmed. Recovery is refresh or read-only Check again, never a repeated borrow or a hidden reverse transfer.

## Interfaces and ownership

Use existing modules and Result/Computed conventions; no new signer, database, background worker or protocol encoder in the agent. The following are proposed interfaces, not existing exports:

| Module / seam | Proposed interface and responsibility |
| --- | --- |
| `packages/shared/src/card.ts` and `snapshot.ts` | Add action-discriminated opening details carrying custody=`wallet`, account/network, collateral/debt token ids, atomic amounts, target bps, source block hash/height and quote inputs. Card numbers are engine-formatted canonical strings; summary/structured amount/payload must agree. Preserve existing repay/Guardian variants and migrate exhaustive consumers. |
| `packages/rhea/src/views.ts` and `snapshot.ts` | A typed opening context read adds only needed deployed-config action flags, supplied/borrowed pool share totals, account shares and withdrawable liquidity to existing pinned snapshots. Read token balances, storage bounds and registration state with matching provenance; never invent them from APR or displayed amounts. Current `AssetState`/`MarketSnapshot` do not provide all of this. Validate raw replies, network, version and matching source block. |
| `packages/engine/src/open-position.ts` (new) | `maxBorrow(input, nowMs)` and `quoteBorrow(input, amountAtomic, nowMs)` return `Result<Computed<...>, EngineError>`: maximum additional principal, binding limit, estimated delivery, resulting rounded debt and health. `quoteCollateralDeposit(input, amountAtomic, nowMs)` returns an engine card draft with balance/storage/fee bounds. Inputs contain validated context and explicit target/fee schedule; no I/O. |
| `packages/rhea/src/tx/open-position.ts` (new) | `collateralDepositPayload(draft, context)` / `borrowPayload(draft, context)` return `Result<NearTransaction[], EngineError>`. Accept only the matching deterministic draft and explicitly supported observed lending version; reuse `ftTransferCall`, `storageDeposit`, `feeTransfers` where applicable. Unknown versions refuse; do not retry another encoding. |
| `packages/agent/src/tools.ts` | Extend validated read/proposal tools with the two action variants and target/amount choices; engine outputs populate `Fact[]`, card numbers and the number checker. Wire payloads outside model-visible tool text as today. A public account selector is not proof of wallet ownership. |
| `apps/web/src/execution/open-position-verify.ts` (new), existing signer/runner/live flow | Issue an immutable verified opening payload after exact semantic validation, then let the existing Connect signer accept only verifier-issued objects. Extend the current verifier-issued-value check deliberately; do not use structural casts or a general-purpose transaction executor. |
| `packages/rhea/src/open-position-outcome.ts` (new) | Parse an opening plan's raw outcomes and reconcile observed post-state. Reuse receipt traversal/RPC validation patterns, not repay-specific success logic: increased debt must not be interpreted as a failed repay. |

Future implementation must update all consumers of extended actions (fees, wire encoding/decoding, chat output guards, cards, execution dispatch and tests). Existing `verifyCardPayload` is repay-only; it must not be widened into a permissive allowlist. Keep operation-specific verification exhaustive and the single signing seam shared. Proposed file names in this design are creation targets, not claims that the files exist.

## Deterministic maximum borrow and health

- Money uses `bigint`/u128-compatible integers. Token atomic, Rhea internal (`atomic × 10^extraDecimals`) and protocol shares are distinct named quantities with explicit conversions. Supply/collateral conversions floor; debt and liabilities ceil; health floors. No floating-point sizing or model arithmetic.
- The user chooses a whole-bps target strictly above Rhea's 10000-bps liquidation boundary. The current comfort setting may prefill it (15000 bps is D28's lead-proposed default, not a new guaranteed or contract-enforced threshold). Never borrow merely because a target or default exists.
- Compute adjusted collateral and debt using `C = sum(value(collateral) × volatility_ratio)` and `B = sum(value(debt) / volatility_ratio)` with the existing scale conventions. Exclude non-collateral supply. Include current debt and the rounded new debt-share liability before calculating `floor(C / B × 10000)`.
- Derive a risk upper bound from `B_after <= C × 10000 / targetBps`, then constrain by verified available liquidity and u128/unit limits. Search candidate atomic principal monotonically using the same conservative share-aware projection as `quoteBorrow`. Return the largest amount satisfying every bound; `max + 1` must violate the named binding bound. A zero maximum is a non-executable result, not permission to borrow dust.
- Do not just add requested principal to an account's rounded debt. Mirror deployed-version debt-share issuance/rounding and supply-share credit/withdrawal rounding. Record independently exercised vectors against imported deployed bytecode, including accrued pools. The source-based model's known one-bps discrepancies are not a universal tolerance or permission to overstate health. Unsupported/unverified share behavior refuses executable borrowing.
- Check all risk prices, including the intended debt asset when current debt is zero. Validate age against both application freshness and the configured lending/oracle validity (historically testnet 60 seconds), using the stricter limit. A fresh snapshot with an expired quote is still blocked. Snapshot age still applies to fixed prices; fixed prices retain `source: default_price`, `publishTimeMs: null` and an explicit fixed-price warning.
- Show maximum **additional** principal at the target, selected principal, estimated amount reaching the wallet, before/after total debt, resulting health, borrow APR, price source/age and each binding assumption. Zero debt is `no_debt`, not infinity. Estimates are not observations; interest/liquidity/prices may move before inclusion.

## Exact transaction shapes and share-rounding guard

All shapes below require version-specific fixture and imported-bytecode proof before enabling that version. Public Gate 1 proves the successful form only on `0.11.0`; existing `0.16.2` repay support is not borrow proof.

| Role | Receiver, method, arguments and deposit |
| --- | --- |
| Required registration | Configured lending/token `storage_deposit({account_id: connectedAccount, registration_only: true})`, exact freshly quoted required minimum, only when missing. Fee-recipient registration uses only that recipient and the configured fee token. Each positive storage deposit is shown separately from a fee and bounded by reviewed configuration. |
| Collateral deposit | Collateral token `ft_transfer_call({receiver_id: lendingId, amount: atomicText, msg: JSON.stringify({Execute:{actions:[{IncreaseCollateral:{token_id: collateralTokenId}}]}})})`, exactly 1 yoctoNEAR. Omit inner amount/max_amount; existing supplied collateral-token balance must be zero, so this cannot collateralize undisclosed supplied tokens. |
| Borrow and deliver | Lending `execute_with_pyth({actions:[{Borrow:{token_id: debtTokenId, amount: internalText}},{Withdraw:{token_id: debtTokenId}}]})`, exactly 1 yoctoNEAR. Withdraw has no `amount` or `max_amount`. |
| Disclosed fee | Only the exact configured fee-token transfer/registration emitted by existing fee helpers, equal to the card's explicit fee lines. No implicit fee or recipient. |

**Amount-omitted action guard:** Rhea's amount-omitted actions can consume all available supplied balance of that token, not merely this card's incremental credit. Require zero pre-existing supplied balance in the relevant collateral token before deposit and the debt token before borrow, checked again immediately before signing. If it is nonzero, refuse with an explanation rather than sweeping/collateralizing it silently or falling back to an exact withdrawal. An existing collateralized balance or existing debt in the supported pair is included normally. No automatic cleanup transfer is added. Concurrent activity after the fresh read remains a disclosed limitation, not an on-chain isolation guarantee.

The verifier binds action/order/count, all nested argument keys, canonical integer strings, gas within proven operation-specific bounds and the NEAR transaction ceiling, exact deposits, token metadata/version, signer/account/network, source context and every structured/displayed amount. Registration recipients and deposits are individually verified. Native transfers, AddKey/DeleteKey, deploy, stake, arbitrary oracle writes, Guardian targets, extra actions and nested extra fields refuse before the wallet. There is no wrapping or swap action in this allowlist.

## Permission boundary, invariants and negative tests

Permission boundary: only the connected NEAR Connect wallet authorizes each reviewed stage as itself. The agent/server holds no signing key; NEAR Auth remains signer-free. The 1-yocto transfer/execute rules are preserved; function-call keys cannot supply those deposits. Rhea enforces the actor's borrowing/collateral rules on-chain; application target health is a preflight constraint, not a new contract policy. Guardian `request_repay` and owner methods are never called.

New invariants, scoped to this extension (not assertions that Guardian I1–I10 apply to a wallet loan):

| Id | Invariant | Required negative/boundary test |
| --- | --- | --- |
| OP-1 | Only the connected account/network's verified function calls to configured lending/tokens/fee recipient reach the existing signer. | Change signer/network/receiver/token/version, smuggle AddKey/native Transfer/Guardian method or forged verified object: zero wallet calls. |
| OP-2 | Reviewed deposit/principal, internal conversion, fee and storage amounts equal payload values. Omitted-amount actions never intentionally consume a pre-existing supplied balance. | Extra nested key, changed decimal scale, amount overflow, exact Withdraw reintroduced, nonzero pre-existing supplied balance at quote or preflight: refuse. |
| OP-3 | Every projected number comes from the engine; selected borrow is positive and no greater than the conservative maximum at the disclosed target. | Max succeeds, max+1 fails the binding constraint, missing/stale intended-debt price refuses, invented numeric model prose is rejected. |
| OP-4 | Borrow cannot execute from a deposit preview; each stage is submitted at most once per card after an explicit approval. | Unsettled/failed deposit, changed collateral/market inputs, double click, cancellation or unknown result: no automatic borrow/resubmission. |
| OP-5 | Confirmation needs relevant successful FINAL receipts, resolver evidence and fresh post-state; hashes or first-receipt success alone cannot confirm. | Successful root with failed receipt, full/partial token refund, debt exists but withdrawal fails, missing hashes/post-state, fee-only success: no false confirmation. |

SMART-CONTRACT I1–I10 are intentionally unchanged because this change does not operate on Guardian reserve, policy, keys or callbacks. It must not claim I2/I3/I6 protection for manual borrowing. Promise-result checking is adopted at the outcome-reader layer, not replaced with a receipt-status shortcut.

## Outcomes and recovery

Use stage-labelled states: draft, blocked, awaiting wallet, submitted, confirmed, failed, partial and unresolved. Pending transaction hashes may be retained internally, but receipt links/results appear only after the outcome reader observes and validates that transaction. Check again is read-only. A card that reached the wallet is not reset for automatic submission, even if a fresh read looks unchanged; a user can create a newly quoted card after reviewing the observed state.

For deposit, observe FT acceptance/refund and collateral/supplied/wallet state. Acceptance alone does not prove collateralization. For borrow, validate both Borrow and Withdraw receipt branches, debt/supplied post-state and actual wallet token transfer evidence; a balance delta alone is not causal attribution. Full confirmation requires delivery evidence as well as the observed increased debt. Registration-only success is not an opened loan. Fee failure after successful deposit/borrow is partial; do not undo the applied stage or charge a fee again automatically. A fresh missing-price rejection after deposit leaves deposited collateral explicitly visible.

If the wallet throws or returns incomplete hashes, obtain a fresh read and show observed change or unknown, never fabricated cancellation, success or explorer links. Show observed balances and health with source/time separately from the earlier engine projection. Character mood stays engine/data-derived; opening debt is not automatically a pleased state.

## Gates, assumptions and non-guarantees

- [U, owner: lead] Validate the precise pool/share/liquidity fields and deposit/borrow ABI per supported deployed version, including non-1:1 supply and borrowed pools, storage requirements and measured gas. No enabled path may use guessed fields or a one-bps tolerance to hide uncertainty.
- [U, owner: founder for pricing; lead for configuration] Resolve fee token, amount, recipient and charging point for each opening stage. D24 covers provisional USDC.e manual execution values, not a REF-denominated or two-stage fee policy. An explicitly approved zero fee is representable; missing configuration must not silently mean zero. Verify fee-recipient registration.
- [V, historical only] Testnet is selected in D19, but Gate 1 is a fixed-price partial pass. USDC's null fresh feed and unverified update path remain blockers for executable USDC borrowing; no unsafe old quote, oracle-update write or silent REF substitution is added.
- [I] Tokens must already be held in the wallet, and the account must have enough NEAR for shown storage/deposits and wallet-estimated gas. This extension neither sources tokens nor creates/funds accounts.
- [U] A real-wallet opening run and post-state proof do not yet exist for this extension. Local fixtures/sandbox stay labelled **Simulated** where shown; public proof needs the applicable explicit human authorization. Mainnet remains separately authorized every time.

Does not guarantee: a future health level, execution at the quote, exact principal delivery, oracle truth, borrow liquidity at inclusion, complete withdrawal availability, transaction atomicity across stages, isolation from concurrent wallet actions, a faithful wallet display, protection from liquidation or Guardian automation. Borrowing adds debt and liquidation risk. Gas can be spent on rejected transactions; storage deposits are not service fees. These limits belong on cards/review copy and in money-path review, not only in this design.
