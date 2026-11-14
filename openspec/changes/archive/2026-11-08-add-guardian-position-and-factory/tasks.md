## 1. Mandatory custody and provisioning gates

- [x] 1.1 STOP: verify founder-recorded D18 G1/G3 before implementation; if open wait, if G2 rescope instead of executing later tasks.
  - D18 recorded as G1 by the user on 2026-11-07 (OPEN-DECISIONS D18); G2 not selected, so this change proceeds. D19/B7 still gate any public account creation or deployment.
- [x] 1.2 Confirm settlement operation/config ABI and version encodings are stable; run a local stored-code/global-contract provisioning/storage/failure-phase experiment on pinned toolchain.
  - Settlement ABI unchanged: `GuardianConfig`/`Policy` and the `0.11.0` Execute/`0.16.2` OnlyRepay encodings are the archived `complete-guardian-request-settlement` surface (28 Guardian unit tests and the sandbox suite pass on the unmodified code). Experiment: `contracts/tests/tests/provisioning.rs` with throwaway `contracts/provision-spike`; both strategies work in the sandbox. Numbers in SMART-CONTRACT "Provisioning experiment".
- [x] 1.3 Record chosen code strategy, account-id derivation, funding floor and create/refund ABI from measured results before factory/client implementation.
  - Recorded in SMART-CONTRACT (Factory, Provisioning experiment): stored code; id `sha256(owner ‖ nonce)` first 32 hex; creation floor 2.37578 NEAR measured, usable floor deferred to 4.2; `create_guardian`/`CreateOutcome`/`claim_refund` ABI. The design assumption of a keyless failed child was not observed: creation is atomic.

## 2. Owner position operations

- [x] 2.1 Write failing owner+1-yocto/foreign-watcher/private-callback tests and reserve/in-flight sweep-race vectors.
  - `contracts/guardian/src/position_tests.rs`, written first and seen failing to compile against the missing implementation; 21 tests incl. reserve-changed-during-read and committed in-flight vectors. A mutation (sweep ignoring the reserve) fails three of them.
- [x] 2.2 Implement configured-token registration/collateral funding and owner borrow/release with fixed Rhea targets and complete receipt/post-state assertions.
  - `position.rs`; sandbox `position_flow::lifecycle` reads back Rhea position and token balances after every step on imported 0.11.0 and 0.16.2 (Simulated prices). The `{"repay":{}}` receiver message of P2.4 is outside this change's tasks and not implemented.
- [x] 2.3 Implement fee-free owner manual reserve repay with refund settlement, plus sweep that excludes all committed reserve/in-flight/fee obligations under the shared lock.
  - Partial and zero refunds and ambiguous results are covered by unit tests; the real-Rhea run exercises exact and full repayment only, not a deployed-Rhea surplus refund.

## 3. Factory lifecycle

- [x] 3.1 Implement validated child creation/deployment/init with a pending-per-owner guard and immutable config; add no access keys or upgrade method.
  - `contracts/guardian-factory`; shared `contracts/guardian-types`. A unit test fails on any key/stake/delete action in the batch; the throwaway spike crate is deleted.
- [x] 3.2 Implement phase-bound creation/refund callbacks and publish owner mapping only after successful initialization.
  - `on_guardian_created` clears the pending guard first (replay fails) and writes mapping and nonce only on a successful batch; `on_refund_resolved`/`on_claim_resolved` decide sent versus claimable from the observed transfer.
- [x] 3.3 Test underfunding, duplicate creates, deploy/init/refund failures, callback replay and keyless failed-child reporting without a fictional full refund.
  - Sandbox, real factory: under-funded batch, existing id, out-of-range funding/gas/policy, concurrent duplicate, forged callbacks. Unit only: replay and the refund-transfer-failure (`claimable`) path. Spike only (commit 85ddd3c): an init panic reverting atomically. Keyless failed-child reporting does not apply: creation is atomic and no child survives a failure.

## 4. Sandbox proof and handoff

- [x] 4.1 Prove empty child key list/I10 and complete owner collateral → borrow → repay → release lifecycle using imported Rhea versions and Simulated prices.
  - `position_flow::lifecycle` on a factory-created Guardian, imported 0.11.0 and 0.16.2; the key list is empty before and after. Not shown: a surplus refund from deployed Rhea on manual repay, or a price-driven trigger.
- [x] 4.2 Run Rust unit/sandbox suites and Clippy; record storage/gas/failure-phase costs and update SMART-CONTRACT/P2.4/P2.6/P2.7 evidence.
  - 86 contract tests pass and `cargo clippy --all-targets -- -D warnings` is clean. Costs, failure phases and the measured registration costs are in SMART-CONTRACT; P2.6 is checked, P2.4 and P2.7 stay open with their remaining gaps stated.
- [x] 4.3 Publish final ABI for add-guardian-client-and-tools; keep public creation/deployment behind D19/B7 and explicit account/funding authorization.
  - SMART-CONTRACT "Final ABI for the client". Nothing was created or deployed on a public network. The remaining `add-guardian-client-and-tools` tasks 3.x are unblocked for the client but were not touched here.
