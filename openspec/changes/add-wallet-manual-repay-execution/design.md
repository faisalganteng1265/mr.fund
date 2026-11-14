## Context

Facts [V, repository]:

- `NearConnector.signAndSendTransactions({ network?, signerId?, transactions: [{ receiverId, actions }] })` returns `Promise<FinalExecutionOutcome[]>` (`@hot-labs/near-connect` types). The user must be signed in.
- `Card.payload: NearTransaction[]` is "built only by `rhea` or `guardian-client` builders, never from model text" (`packages/shared/src/card.ts`). A card also carries `numbers`, `fees`, `dataAgeMs`, `maxDataAgeMs` and an optional `receipt` (`submitted | confirmed | failed | partial`, `txHashes`, `observed`, `atMs`).
- `RepayPlan` needs a known hash per transaction, plus signer, receiver, method, exact `argsJson`, deposit and role (`repay`, `fee`, `registration`); exactly one repay, fees after it. Hashes "come from trusted application/wallet plumbing, never from model arguments" (`docs/technical/REPAY-OUTCOMES.md`).
- `readRepayOutcome(plan, reader, { before, observer })` performs one bounded pass; it never retries a transfer. Token acceptance alone never yields `confirmed`: a fresh post-state with a debt decrease is required.
- NEAR Auth accounts have no signing path (`AuthAdapter` is deliberately signer-free).

## Decisions

- **Signer is a capability of the Connect session, not of every adapter.** A separate `TransactionSigner` interface is returned only by the NEAR Connect adapter for the current session. The controller still never exposes a signer on `WalletState`, so every existing test of that invariant keeps its meaning. UI code asks `session.canSign` (derived from the method) and receives the signer through the execution port only. Negative test: an Auth session has no signer and Execute stays disabled.
- **Verify before asking the wallet.** `verifyCardPayload(card, expected)` is a pure function. `expected` comes from public configuration (network, Rhea lending contract id, fee recipient id; added as public, non-secret `NEXT_PUBLIC_*` variables if the browser cannot already obtain them) and from the session account. It checks: every transaction `receiverId` is the card's token contract or a configured fee contract; each action is a `FunctionCall` whose method is in an allowlist (`ft_transfer_call`, `ft_transfer`, `storage_deposit`); `ft_transfer_call.receiver_id` equals the configured lending contract; deposits are exactly `1` yoctoNEAR for transfers and the card-stated amount for storage deposits; fee transfers go to the configured recipient and sum to the card's fee lines; the repay amount equals the card number; nothing else (no `AddKey`, `DeleteKey`, `Transfer`, `DeployContract`, `Stake`). This does not trust the model, because the model never supplies payloads, but it also does not trust the server blindly: a compromised or buggy route cannot make the browser sign a transfer to another contract without failing a visible check. The exact allowlist is finalized in task 1.1 from an inventory of builder output (`packages/rhea/src/tx/repay.ts`, `packages/shared/src/nep141.ts`); anything unlisted is refused.
- **Confirm in the app, then the wallet shows its own screen.** The in-app confirmation lists the repaid amount and token, each fee line with recipient, the network, and the account that will sign, all from the verified payload. The wallet's own review screen is a second, independent display.
- **One execution per card.** An in-flight lock keyed by card id prevents double submission; a second activation is ignored. After submission the card cannot be executed again; a new card requires a new snapshot.
- **Freshness before signing.** Execute re-checks `dataAgeMs < maxDataAgeMs` and takes a fresh final-block position read (`before`) immediately before the wallet call; if the new read differs materially from the card's inputs (debt lower or health changed, as defined by the engine), it blocks and asks to refresh the card instead of signing on stale numbers.
- **Outcomes by observation, not by assumption.**

  | Wallet result | State | Next |
  | --- | --- | --- |
  | Resolved with outcomes | `submitted` with hashes | `readRepayOutcome` → `toCardReceipt`, then fresh position |
  | Error or rejection before any hash known | `unconfirmed` | Re-read position; if debt equals `before`, return the card to draft with "nothing was sent that I can see"; if it changed, show a receipt derived from observation |
  | Reader cannot yet resolve | `submitted` (pending) | Explicit Check again action, no polling loop |

  Wallets differ in how rejection is reported [U], so the code does not rely on error strings to decide "nothing happened"; observation decides. A thrown error never produces `confirmed`.
- **Hashes come from the wallet result, not the model or server.** Each `FinalExecutionOutcome` carries its transaction hash; the plan is built from the verified payload plus those hashes, then validated by `validateRepayPlan`.
- **Where outcome reading runs.** In the browser against the configured public RPC through `createOutcomeReader`, because the plan's hashes exist only in the browser session and the RPC is the trust boundary either way. Task 1.4 first confirms `@mrfund/rhea` imports no Node-only module in this path; if it does, a server route would be specified in a follow-up proposal instead of silently moving the trust boundary.
- **Links appear only after observation.** The explorer link (`https://testnet.nearblocks.io/txns/<hash>` or the mainnet equivalent [I], configured per network) renders only after the outcome reader returned evidence for that hash.
- **Reuse, do not re-implement.** Parsing, refund accounting, receipt status mapping and health comparison stay in `packages/rhea` and `packages/engine`. The web layer adds only: signer wrapper, payload verifier call, plan assembly from wallet results, and rendering.
- **Fees are shown and verified.** Fee lines are part of what the verifier checks and what the confirmation shows, before signing. A fee transfer failing after a successful repay is `partial`, as the parser already reports; the UI says what happened to each part.

## Permission boundary, invariants and negative tests

Permission boundary: only the user's wallet signs. The app never sees a private key, never requests an access key or plugin, and never calls the Guardian here. The server cannot cause a signature: it can only propose a card, and the browser verifies the payload and the user approves twice (in app, in wallet).

Invariants:

- E1: the wallet is asked to sign only payloads that passed `verifyCardPayload` for the current session account and network.
- E2: `confirmed` is shown only when the parser reported it from verified evidence and a fresh post-state; thrown errors and token acceptance alone never yield it.
- E3: at most one submission per card.
- E4: a failed or partial later transaction never resets an already applied repay to an untouched draft (REPAY-OUTCOMES consumer rule).
- E5: NEAR Auth sessions cannot reach the signer.

Negative tests (fake wallet, recorded fixtures): payload with an extra `AddKey`/`Transfer` action; wrong receiver; wrong deposit; amount differing from the card; fee to the wrong recipient; wrong network; signer ≠ session account; stale card; position changed since card; Auth session; double activation; wallet rejection; wallet error after partial progress; reader timeout; each recorded outcome fixture (success, surplus, full refund, partial refund, Rhea action failure with successful top-level return, failed fee) mapping to the documented receipt table.

It does not guarantee: that the wallet's own transaction display is accurate, that repayment improves health beyond what the post-state shows (debt delta is not causal attribution), that an unknown Rhea version is handled (it refuses), or any behavior on mainnet before authorization.

## Final allowlist (task 1.1, 2026-11-10)

Inventory of `rhea.repayPayload` + `shared.feeTransfers`: (1) `<debt token>.ft_transfer_call({receiver_id: <lending>, amount, msg})`, 1 yocto, `msg` = `"OnlyRepay"` (0.16.2) or `{"Execute":{"actions":[{"Repay":{"token_id","max_amount"}}]}}` with `max_amount = amount × 10^extra` (0.11.0); (2) optional `<fee token>.storage_deposit({account_id: <fee recipient>, registration_only: true})`, deposit in (0, 0.1 NEAR]; (3) `<fee token>.ft_transfer({receiver_id: <fee recipient>, amount})`, 1 yocto, only with exactly one fee line. Each transaction has one action with exactly `methodName/args/gas/deposit` and gas ≤ 300 Tgas. The repay amount is the engine headline `Repay <amount> <symbol>` for the session's debt token.

## Risks

- Wallets may not return outcomes for every transaction in a batch on partial failure [U]. The observation-based `unconfirmed` path is the mitigation and is tested with injected partial results; real behavior is proven only by public wallet evidence (P4.5).
- Gas values for production builders are unmeasured estimates [I, BUILD-PLAN P4.2]; a gas shortfall would appear as a failed outcome and is recorded, not hidden.
- Adding public environment variables for the lending and fee ids creates a second copy of server configuration. Mitigation: one shared reader with a startup consistency check; a mismatch blocks Execute.
