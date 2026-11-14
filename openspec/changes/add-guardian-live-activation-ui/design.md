## Context

Facts [V, repository, 2026-11-09]:

- Factory `create_guardian(policy: Policy)` is `#[payable]`; the predecessor becomes the owner; the attached deposit must lie in `[min_funding, max_funding]`; at least 145 Tgas must be attached; one creation per owner may be in flight; the Guardian id is `get_next_guardian_id(owner)`; the result is `created` or `failed` with `refund: sent | claimable`. The batch contains create-account, transfer, deploy and `new` only (invariant I10: no access key). Creation floor 2.75325 NEAR for the current build.
- Owner position methods need the owner account and exactly 1 yocto: `owner_register({target_id, storage_deposit})`, `owner_borrow`, `owner_withdraw_collateral` (≥ 260 Tgas), `owner_repay_from_reserve` (≥ 115 Tgas), `owner_sweep`. Reserve funding is the debt token's `ft_transfer_call(receiver_id: <guardian>, msg: {"activate":{}})` for reserve plus activation fee; `ft_on_transfer` accepts only owner-sent debt tokens with strict `activate`/`reserve` messages.
- The activation fee is immutable `GuardianConfig.activation_fee` set from the factory template (not a chosen product price; D24 open).
- PRD F6 fixes the form fields and minimums: trigger ≥ 105%, cooldown ≥ 5 minutes, max per action ≤ reserve minus floor, total ≥ per action, reserve deposit ≥ per action + one action fee + floor with the activation fee on top.
- The factory ABI is not yet deployed anywhere (SMART-CONTRACT "Not deployed").
- `get_status.in_flight` shows amount and fee but not the operation kind; an unresolved manual repay appears as an in-flight lock.

## Decisions

- **Activation as three independently observable steps, each its own card.** (1) `create_guardian` with funding; (2) `owner_register` for the lending contract and tokens; (3) reserve plus activation fee via `ft_transfer_call … {"activate":{}}`. A step can fail or be rejected, so each step reads its own outcome and the UI resumes from observed on-chain state (Guardian exists? registered? active?) instead of from local memory. Reloading the page mid-activation restores progress from `get_guardian(owner)`, `get_status` and registration views. One wallet batch per step; no batch is assumed atomic across steps.
- **Never show "created" from a hash.** The UI shows the Guardian only after the factory result is `created` (or `guardian_created` evidence). `failed` shows the phase and the refund state; `claimable` offers `claim_refund` (1 yocto, owner-signed) with the exact amount.
- **Fees come from chain.** The activation fee and recipient are read from the factory/Guardian template and shown with recipient before signing; the UI never hard-codes them. A mismatch between the displayed fee and the payload fails verification.
- **Validation lives in the engine, not the form.** The form uses the engine/guardian-client policy validation (the same rules the contract enforces) so UI and contract cannot drift; the summary text is generated from the policy struct and a test asserts every number in the summary equals the number in the payload. Each invalid field blocks review with a specific message.
- **Reuse the verified-payload path.** Owner controls and activation steps go through the same `verify → confirm → wallet → observe` pipeline defined in `add-wallet-manual-repay-execution` (generalized per action kind: allowlisted receiver = the user's Guardian or the factory, allowlisted methods, deposits exactly 1 yocto except funding). No second signing path.
- **Connect sessions only.** NEAR Auth accounts cannot create a Guardian from the UI; the form is viewable and says why signing is unavailable.
- **Panel reads are public and bounded.** Status, limits, reserve and spendable, history and heartbeat use `@mrfund/guardian-client` against the configured RPC with block-pinned reads; history shows retained-ring truncation honestly; unavailable evidence (transaction links without a verified event source, hashes) shows as unavailable, never invented. A watcher heartbeat older than its threshold shows as offline with the exact age.
- **Deactivated semantics.** Deactivate stops future automation, does not reverse past actions and does not disable owner withdrawals; the panel disables automation controls but keeps withdraw. It does not claim NEAR is recoverable: the keyless account has no NEAR withdrawal.
- **Loan building decision (2026-11-11).** The user chose P0 UI for collateral deposit, `owner_borrow` and `owner_sweep` for the Guardian-held loan. Task 5.5 implements them (2026-11-11, local only) as a Loan section on the activated panel: `guardianPositionPayload` builds each call, `verifyGuardianPayload` checks it, and `apps/web/src/guardian/loan.ts` reads holdings (Rhea `get_account`, `ft_balance_of`) and compares the reads before and after each step. Gas is the 300 Tgas the sandbox flow attached; the verifier floors are 180 Tgas for the collateral transfer (140 must reach the Guardian) and 260 Tgas for `owner_borrow`. No health factor is computed for a borrow; Rhea refuses one that leaves the position unhealthy.
- **Simulation stays labelled.** The simulated Guardian remains the demo source and the replay path for an over-limit rejection until a real rejection transaction link exists (P5.5).

## Permission boundary, invariants and negative tests

Permission boundary: only the owner's wallet signs creation, registration, reserve deposit and owner controls; the watcher's function-call key is limited to `request_repay` and is not touched here; the app holds no key. The factory enforces funding range, gas floor and policy validity; the Guardian enforces owner-only methods and policy rules; the browser's verifier prevents signing anything else.

Invariants:

- G-UI-1: the wallet is asked to sign only verified payloads whose receiver is the configured factory, the user's own Guardian, the configured debt token or the lending contract, with allowlisted methods.
- G-UI-2: summary numbers equal the payload numbers (test-enforced).
- G-UI-3: a Guardian is displayed as created only after observed success.
- G-UI-4: every step's progress derives from on-chain state, not component memory.
- Inherited: SMART-CONTRACT I1–I10 stay contract-enforced; this change adds none and weakens none.

Negative tests: each invalid form field per PRD F6 at its exact boundary (trigger 104.99% vs 105%, cooldown just below 5 minutes, per-action above reserve minus floor, total below per-action, deposit below minimum); funding below `min_funding` and above `max_funding`; payload with an `AddKey` action; wrong factory; creation already in flight; `failed` with `claimable` refund; resume after reload at each of the three steps; non-owner view; Auth session; stale snapshot; withdraw while in flight; deactivated Guardian disables automation but not withdraw; heartbeat offline; history truncated; unknown in-flight outcome shown as locked, never clearable.

It does not guarantee: that the watcher acts (the heartbeat is only liveness evidence), that automation protects the position (the policy can reject an action; the contract's trigger check depends on oracle freshness, D27), that a failed or lost creation refund covers gas, that a Guardian can be upgraded or its NEAR withdrawn, or any behavior on a network before P2.8 evidence exists.

## Risks

- The immutable activation fee couples this UI to a deploy-time decision (D24). Mitigation: fee read from chain; the UI works with any value, including zero, and displays it.
- Multi-step activation can strand a half-created Guardian (created, not activated). Mitigation: resume-from-chain, clear state labels, and an explicit "Deactivate" and withdrawal path.
- Gas floors (145 Tgas create, 260 Tgas borrow) exceed some wallets' defaults; payloads set gas explicitly and the wallet result is the proof, recorded not assumed.
