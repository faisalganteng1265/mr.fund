## Why

Guardian activation and owner controls are BUILD-PLAN P5.1 and P5.2 and the core of PRD F6/F7 (opt-in automatic repay within limits the user set, enforced on-chain). The contracts exist (`contracts/guardian`, `contracts/guardian-factory`, final client ABI recorded in SMART-CONTRACT "Final ABI for the client"), the read side exists (`@mrfund/guardian-client` reads and tools), and the existing `/play` Guardian setup, review, controls and replay screens are fully simulated (`guardian`, `reserve`, `setupReview` state in `Playground.tsx`). No real user can create a Guardian.

Two repository facts shape this change:

1. `guardianOwnerPayload` still refuses `activate` with "Activation is unavailable until the final provisioning ABI is verified", and `add-guardian-client-and-tools` tasks 3.1–3.3 still wait for that ABI, yet the factory was archived on 2026-11-08 and SMART-CONTRACT now documents the final ABI (`create_guardian({policy})` with NEAR funding in `[min_funding, max_funding]`; `owner_register`; reserve through `ft_transfer_call` with the `activate` message). The activation payload builders are therefore unblocked and are the first task here.
2. `docs/technical/ARCHITECTURE.md` Flow 3 still describes `create_guardian(label, policy, watcher_id)` and an access-key batch that the real factory does not implement. The contract and SMART-CONTRACT are authoritative [V, code read 2026-11-09]. This change records the contradiction and fixes the doc in the same commit as the builder.

## What Changes

- Finish the unsigned **activation payload builders** in `packages/guardian-client` against the final ABI: factory creation with funding, registrations via `owner_register`, and the reserve plus activation fee deposit. Pure, tested, no signer. Closes `add-guardian-client-and-tools` 3.1–3.3.
- Add the **live `guardian` port** (reads through `@mrfund/guardian-client` against the configured RPC; owner controls as verified payloads signed by the user's wallet, Connect sessions only).
- Replace the simulated Setup/Review with the PRD F6 form over the real policy: field validation by the engine, plain-language summary whose numbers equal the policy struct sent, fees (read from the factory template, not hard-coded) with recipient before signing, creation sequence with honest progress.
- Replace the simulated Guardian panel and controls: status, limits, reserve and spendable, history, watcher heartbeat age, Pause, Resume, Deactivate, Withdraw, each a verified card with a wallet signature; a created Guardian is shown only after the `created` outcome or `guardian_created` event, never after a transaction hash alone.
- Surface contract gaps honestly (for example an in-flight lock with unknown manual-repay outcome) and the keyless-account limit (NEAR cannot be withdrawn).
- Keep the simulated Guardian as the labelled demo path and for the replay of an over-limit rejection.
- Fix ARCHITECTURE Flow 3, update P5.1/P5.2 progress with observed evidence only.

## Capabilities

### New Capabilities

- `guardian-activation-ui`: Real Guardian creation, activation, status and owner controls through the user's wallet.

### Modified Capabilities

None.

## Impact

`packages/guardian-client/src/tx/` (activation builders), `apps/web/src/guardian/` (Setup, Summary, Panel), `apps/web/src/play/` (surface wiring and the live port), `apps/web/test/`, `docs/technical/ARCHITECTURE.md` (Flow 3), `add-guardian-client-and-tools` tasks 3.1–3.3, BUILD-PLAN P5.1/P5.2.

Depends on `refactor-consultation-data-source`, `add-live-wallet-session-ui` and the verifier/signer from `add-wallet-manual-repay-execution`.

Gates: builders, validation and UI against a fake client and recorded sandbox fixtures are local. Anything live needs P2.8 (testnet factory and Guardian code deployed), D19 (network), B7 (funded testnet owner account, test tokens, watcher account), D24 (the activation fee is immutable in the factory template and must be decided before deployment), D27 (public trigger path; sandbox-proven only) and D29 (watcher host). Creating a Guardian costs real NEAR on the chosen network (floor 2.75325 NEAR for the current build [V, sandbox]); mainnet needs explicit human authorization. On 2026-11-11 the user decided that P0 will offer collateral deposit, `owner_borrow` and `owner_sweep` in the UI; implementation remains open (task 5.5).
