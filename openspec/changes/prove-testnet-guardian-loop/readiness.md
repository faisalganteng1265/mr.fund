# Readiness record (task 1.1)

Compiled 2026-11-10 from repository evidence only. No key was read, no account created, no transaction sent and no public RPC write attempted. Classification per prerequisite: **observed-local** (tested in this repository, sandbox or unit), **unproven-public** (no public-network observation exists) or **missing** (owning implementation or decision not done).

Re-run note [V, 2026-11-10]: `pnpm contracts:test` could not be re-run on this machine (`cargo: command not found`). Contract evidence below is the recorded evidence with its original date, not a fresh run. TypeScript suites were re-run on `dev` at `63452c0`: `pnpm test` 1174 passed / 3 skipped, `pnpm typecheck` and `pnpm lint` clean.

## 1. Local evidence by gate

| Gate | Evidence (source, date) | Classification |
| --- | --- | --- |
| P0.3 Gate 2, contract owns a Rhea loan | BUILD-PLAN P0.3 [V, 2026-11-06]: near-workspaces sandbox on downloaded Rhea bytecode, testnet `0.11.0` (code hash `7WFMoeahr43So9dbfkKxYXvhLgT2qysVXvwXrBWUxzeH`, block 276422053) and mainnet `0.16.2` (code hash `6Nek1MZ8cwJJ2xMQAUWup9V5AToYS9rkTxJfwo6BCpFa`, block 223247760); `contracts/tests/tests/probe.rs`; 3 sandbox + 11 probe unit tests; Simulated prices | observed-local; live step 3 unproven-public |
| P0.4 Gate 3, trigger with fresh prices | BUILD-PLAN P0.4 [V, 2026-11-06/07]: `probe_check_trigger`, `fixtures/trigger-vectors.json` zero-bps parity, null/expired price rejection; composed read→repay→resolver→fee at 300 Tgas root with >31 Tgas trigger and >17 Tgas settlement margin (GUARDIAN-SETTLEMENT) | observed-local; actual token/oracle (D27/B4) unproven-public |
| P2.6 factory | BUILD-PLAN [V, 2026-11-07]: 9 unit + 4 sandbox tests, keyless child, creation floor 2.75325 NEAR for the current build | observed-local; deployment (P2.8) missing |
| P2.7 sandbox integration | BUILD-PLAN [V, 2026-11-07]: 86 contract tests; factory-created keyless Guardian ran register, collateral, borrow, sweep, manual repay, release on both imported versions | observed-local, incomplete: watcher-driven automatic repay, price-drop scenarios and property test unrun (box open) |
| Outcome recordings | `fixtures/outcomes/` six scenarios × two versions, provenance `sandbox`, prices Simulated (REPAY-OUTCOMES) | observed-local |

Artifact hashes: only the imported Rhea code hashes above are recorded. No reproducible Guardian or factory WASM hash exists yet; `cargo near build reproducible-wasm` is a P2.8 step (4.1) and needs a Rust toolchain.

## 2. Implemented client ABI (as of `dev` 63452c0)

- Factory: `create_guardian({policy})` with funding in `[min_funding, max_funding]`, ≥ 145 Tgas; `claim_refund()` 1 yocto; views `get_guardian`, `get_next_guardian_id`, `get_template`, `get_limits`, `get_unclaimed`, `is_pending` (SMART-CONTRACT "Final ABI for the client"). Client builders: `packages/guardian-client/src/tx/activation.ts` (PR #12).
- Guardian owner: `owner_register({target_id, storage_deposit})` 1 yocto; reserve activation via debt-token `ft_transfer_call(..., {"activate":{}})`; `pause/resume/deactivate/owner_withdraw_reserve/set_policy/rotate_watcher` 1 yocto (`tx/owner.ts`).
- Watcher: `request_repay(amount)` zero deposit, function-call key restricted to that method and Guardian (`apps/watcher/src/core/authority.ts`, PR #7).
- Wallet repay: version-aware `repayPayload` (`0.11.0` bounded `Repay.max_amount`, `0.16.2` `OnlyRepay`); browser verifier/signer/runner `apps/web/src/execution/` (PR #13).

## 3. Missing dependencies and owners

| Needed for | Missing piece | Owner | Status |
| --- | --- | --- | --- |
| 1.2 and everything after | B7/P0.5 testnet accounts (demo user, deployer, factory, watcher, fee recipient, probe), faucet NEAR, listed test-token access | founder / explicitly authorized lead | missing |
| fee-bearing steps | D24 provisional test-token fees, recipient, units | founder | missing |
| 2.3, 4.x, 5.x | D19 network decision | founder | open |
| 4.1 | Rust toolchain + `cargo near` on the operator machine; reproducible build | lead | missing on this machine |
| 4.2 (P4.5) | wallet UI surfaces: Execute, confirmation, receipt (`add-wallet-manual-repay-execution` 3.1–3.3) and live cards (`connect-consultation-to-live-chat`) | frontend | logic done (PR #13); surfaces missing |
| 4.3 (P5.1/P5.2) | activation/controls UI and Guardian verifier extension (`add-guardian-live-activation-ui` 2.3, 3.x, 4.x); loan-building decision 5.1 | frontend / lead | builders done (PR #12); rest missing |
| 5.2 (P5.3) | watcher Node entry with local key source (`add-deterministic-guardian-watcher` 3.1) | lead | core done (PR #7); entry missing |
| 5.3 (P5.4) | `scripts/demo/request-over-limit.ts` (watcher 3.2) | lead | missing |
| 5.2 hosted | D29/B8 host account and cost | founder | open |
| 5.4 (F7) | event→transaction linkage and activation ledger (`guardian-client` reports `transactionLinks: "unavailable"`); D25/P3.4 GLM acceptance | lead | missing / open (34/36) |
| 5.1 | actual token/oracle trigger observation (D27/B4) | lead | open |

## 4. Contradictions surfaced for owning-doc review (not resolved here)

1. **Repay message on 0.11.0.** BUILD-PLAN P0.3 step 1 still says repay with `"OnlyRepay"`, and INTEGRATIONS recipe 3 step 5 says the 0.11.0 inner field is `amount`. Deployed testnet 0.11.0 rejects `OnlyRepay`, and the implemented builder emits bounded `Repay.max_amount` after a failing strict-`amount` dust regression (BUILD-PLAN P0.3 follow-up). Owner: lead, before running recipe 3.
2. **Factory ABI in ARCHITECTURE Flow 3.** Was `create_guardian(label, policy, watcher_id)`; corrected to the final ABI on 2026-11-10 (PR #12, LESSONS entry). Resolved in docs; still to be confirmed against the compiled artifact during 4.1.
3. **SMART-CONTRACT status line** says D18 is "recommended, not yet chosen"; OPEN-DECISIONS records D18 = G1 decided 2026-11-07. Owner: lead.
4. **Guardian `{"repay":{}}` receiver.** ARCHITECTURE Flow 2 (G1 paragraph) and `guardianRepayPayload` describe it as a working path; SMART-CONTRACT and BUILD-PLAN P2.4 say it is not implemented (owner uses `owner_repay_from_reserve`). It must not be counted as P4.5 evidence. Owner: lead.
5. **Guardian repay message vs version (doc only).** SMART-CONTRACT's `{"repay":{}}` row says the Guardian forwards with `OnlyRepay`. The code is version-aware: `contracts/guardian/src/repay.rs:144` emits `"OnlyRepay"` for 0.16.2 and bounded `Repay.max_amount` for 0.11.0 [V, code read 2026-11-10]. The SMART-CONTRACT wording is stale, not the contract. Owner: lead.

## 5. Money-path matrix (summary of design.md, unchanged)

| Path | Permission boundary | Invariants / negative evidence required | Does not guarantee |
| --- | --- | --- | --- |
| Plain wallet / probe lending | wallet owner approves; probe owner + 1 yocto | non-owner probe call rejected; contract-sender repay leaves another account's debt unchanged | token acceptance ≠ repayment |
| Factory + activation | factory predecessor owns child; bounded funding; owner-only debt-token deposits | I4/I5/I10; public keyless creation and terminal callback | no upgrade, storage NEAR or gas refund |
| Automatic request | function-call key: `request_repay` only, fixed receiver, finite allowance, zero deposit | I1–I8; public max+1 refusal with unchanged reserve/debt | no uptime or liquidation prevention |
| Owner shutdown/recovery | stored owner + 1 yocto; shared in-flight lock | I5/I7/I8/I9; public paused refusal, post-withdraw balances | past actions irreversible; Unresolved can block withdrawals |

No task beyond 1.1 is claimed. Every public step in tasks 1.2–6.2 stays unchecked until its own observed evidence exists.
