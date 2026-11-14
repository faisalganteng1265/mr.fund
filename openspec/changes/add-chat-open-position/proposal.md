Stretch: implement only after the core submission is complete.

# [EXTEND] Open a plain-wallet Rhea position from chat

## Why

[I, proposed extension] A user without a loan currently receives an empty-position explanation (PRD F2), not an executable opening flow. After the core submission is complete, chat can guide a collateral deposit and borrow using the same deterministic card, browser verifier, wallet approval and observed-outcome discipline as manual repay. This is additional scope, not an uncompleted P0 requirement or permission to change the feature freeze.

[V, recorded evidence, 2026-11-11] INTEGRATIONS recipe 3 records a plain-account testnet cycle with fixed-price wNEAR collateral and REF debt. It also records two failures: USDC borrowing lacked a price, and `Borrow(x)` plus exact `Withdraw(x)` reverted because supplied-share credit floors while exact withdrawal share debit ceils. The successful amount-omitted withdrawal delivered one token atomic unit less than requested. These are constraints, not proof that a chat opening flow already exists.

## What Changes

- Add chat intent and deterministic cards for **wallet collateral deposit**, then **wallet borrow**; each stage requires review and its own explicit wallet approval. Borrow is quoted again only after collateral is observed on-chain.
- Extend `packages/engine` to calculate the maximum additional borrow at a disclosed target health and the resulting debt/health, using validated prices, liquidity and deployed-version share rounding. The model explains tool facts; it never computes or supplies transaction bytes.
- Add version-verified deposit/borrow builders in `packages/rhea`, tightly allowlisted verification beside `apps/web/src/execution/verify.ts`, and Connect-only signing through the existing execution path.
- Observe FINAL receipts, token-transfer resolution, wallet balances and fresh Rhea state before confirmation. Preserve deposit-applied/borrow-failed and other partial or unresolved outcomes; no automatic resubmission.
- Label configured fixed prices as fixed; label hypothetical price changes and replays **Simulated**. Refuse missing/stale prices rather than substituting a quote.

## Capabilities

### New Capabilities

- `chat-open-position`: User-approved plain-wallet Rhea collateral deposit and borrow, with engine sizing, verified cards and reconciled outcomes.

### Modified Capabilities

None in this delta. Existing repay and Guardian capabilities retain their permissions and behavior.

## Non-goals

Guardian-held opening or migration, automatic borrowing, watcher changes, new contracts, native-NEAR wrapping, swaps, cross-chain funding, yield placement, multiple collateral/debt pairs, mainnet execution and any private-key handling. Wallet-held loans do not gain Guardian protection; the later Guardian-held flow needs separate work and evidence.

## Impact and gates

[I] Future implementation touches shared card/action types and consumers, engine calculations, Rhea reads/builders/outcomes, agent tools/number guards and the web execution/card flow. Reuse repository Result, integer-unit, freshness and Connect-only signing conventions. BUILD-PLAN P0.2/Gate 1, P1.2/P1.4, P4.1–P4.5 and the existing wallet-execution change are dependencies/reference evidence, not boxes this proposal satisfies.

[U] Price-feed recovery, deployment-specific borrow gas/rounding evidence and the applicable deposit/borrow fee schedule remain enablement gates. D24's provisional USDC fees are not a REF fee decision. No account creation, login, deployment, fee-bearing signature or mainnet transaction is authorized by these documents. All implementation/evidence tasks remain unchecked.
