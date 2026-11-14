## 1. Feasibility and ABI

- [x] 1.1 Confirm protocol encoding tests from verify-rhea-protocol-evidence and enumerate policy/settlement invariant cases against the current reserve lock.
- [x] 1.2 Prototype complete trigger-read → repay → resolver → fee callback chain on both imported versions with success/refund/failure paths; record per-receipt allocated/burnt gas and continuation margin.
- [x] 1.3 Gate integration on passing composed gas evidence; if it fails, record B4/D27 findings and stop preferred integration rather than choosing a fallback.
- [x] 1.4 Specify verified version/extra-decimal config and operation-phase ABI additions; update SMART-CONTRACT draft and coordinate dependent client/factory proposals.

## 2. Authorization and trigger

- [x] 2.1 Add failing unit tests for every RejectReason, exact boundaries, foreign caller, deposits and checked overflow.
- [x] 2.2 Implement zero-deposit owner/watcher request gating, operation allocation and shared lock across reserve and trigger phases.
- [x] 2.3 Port supported fresh trigger reads with stored policy/config, strict threshold and pause/deactivate callback rechecks; test malformed/stale/null/future/unsupported shape.

## 3. Settlement and history

- [x] 3.1 Implement private op/phase-bound resolver accounting for accepted/refunded amounts; cover full refund, transfer failure, duplicate callback and legacy supplied surplus.
- [x] 3.2 Implement fee reservation and terminal fee callback; failed fees restore proven fee reserve and do not increase fee_charged.
- [x] 3.3 Implement conservative unresolved-result handling and test that malformed/ambiguous callbacks cannot create reserve or unlock spending; prove any reconciliation balance deltas before allowing recovery.
- [x] 3.4 Write last-50 Attempt history and NEP-297 events for rejection/start/failure/settlement with explicit accepted-spend semantics.

## 4. Integration evidence

- [x] 4.1 Run imported-version sandbox accepted/rejected/fee-failure/pause-race/supplied-surplus scenarios and all I1–I9 invariant cases affected by new locks. Prove partial/full-refund bookkeeping separately with explicitly controlled NEP-141 receivers in both encodings; do not claim deployed Rhea returns those controlled refunds.
- [x] 4.2 Run Rust unit/sandbox suites, Clippy and affected TS parity suites; record composed gas, exact results and remaining limits in SMART-CONTRACT/BUILD-PLAN.
- [x] 4.3 Keep public deployment and product execution gated on D18/D19/B7 and any unresolved D27 outcome; do not mark all P2.7 or public P0.3 complete from local evidence.
