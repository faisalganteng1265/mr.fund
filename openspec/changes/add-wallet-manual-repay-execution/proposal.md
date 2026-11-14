## Why

BUILD-PLAN P4.3 ("Wallet and receipts") has its backend finished and tested: `packages/rhea` builds repay payloads, parses wallet-submitted outcomes (`parseRepayOutcome`), reads them from chain (`createOutcomeReader`, `readRepayOutcome`) and maps them to the shared receipt (`toCardReceipt`). The remaining P4.3 work is explicitly open in BUILD-PLAN: "NEAR Connect/wallet submission and cancellation handling, UI integration and public wallet execution". Today `/play` fakes this with a mock wallet that can succeed, cancel, fail or partially succeed (`walletOutcome` in `Playground.tsx`), so no real user can repay. P4.5 ("First real manual repay") and Phase 4 acceptance ("a real wallet-signed repay produced a receipt with a resolving transaction link and an observed health change") cannot happen without this change.

This is a money path: it asks a user's wallet to sign a token transfer. It therefore needs an explicit permission boundary, invariants, negative tests and a stated limit.

## What Changes

- Add a **transaction signing capability for NEAR Connect sessions only**: a narrow `TransactionSigner` wrapping the connected wallet's `signAndSendTransactions`. NEAR Auth sessions have no signer; the existing `AuthAdapter` stays signer-free.
- Add a **pure card-payload verifier** in the browser path: before asking the wallet, check that the payload targets only the configured token/lending/fee recipient contracts, uses the expected methods and deposits, signer equals the session account, network matches, and amounts equal what the card shows (including fees).
- Add the **live `execution` port**: confirmation summary (amount, fees, recipient) → wallet signature → transaction hashes → `readRepayOutcome` → `toCardReceipt` → fresh position snapshot. Cancellation, failure, partial and unknown outcomes are distinct, honest states.
- Enable the card's Execute control for Connect sessions with fresh data; keep it disabled with a reason for Auth accounts, stale data, a missing signer, or a network mismatch.
- Show receipts and explorer links only after an outcome is observed.
- Update P4.3 and P4.4 progress with observed evidence. P4.5 (public wallet proof) is recorded by `prove-testnet-guardian-loop`, not claimed here.

## Capabilities

### New Capabilities

- `manual-repay-execution`: Browser wallet signing of a verified repay card, outcome reconciliation, receipts and honest failure states.

### Modified Capabilities

None.

## Impact

`apps/web/src/wallet/` (signer capability on the Connect adapter), `apps/web/src/play/source/` (live `execution` port), `apps/web/src/play/` (Execute, confirmation and receipt surfaces), `apps/web/test/`; possibly a read-only export of an existing verifier helper from `packages/rhea` (decided in task 1.1). Depends on `refactor-consultation-data-source`, `add-live-wallet-session-ui` and `connect-consultation-to-live-chat` (cards, position, formatter).

Gates: all local work uses a fake wallet and the twelve recorded outcome fixtures per version, with no external gate. Public wallet execution needs D19 (network), B7 (a funded testnet account that holds the repay token and a Rhea position), and an authorized spend, none of which this change obtains or implies. Rhea testnet is `0.11.0` and mainnet `0.16.2` [V, BUILD-PLAN]; the builders are version-aware and unknown versions refuse. No mainnet transaction occurs without explicit human authorization.
