## 1. Validated reads

- [x] 1.1 Define injectable view client and typed status/policy/reserve/history results against actual Rust views, including missing evidence and retained-ring semantics.
- [x] 1.2 Implement block-pinned reads and strict u128/U64/enum validation with typed not-found/unavailable/bad-response errors.
- [x] 1.3 Add backend history sinceMs/limit handling, provenance and truncation tests; no frontend filtering.

## 2. Agent integration

- [x] 2.1 Migrate dispatch and every caller/test to an awaitable API, preserving existing validation/refusal behavior.
- [x] 2.2 Implement guardian_status and guardian_history with SourceNumbers from validated reads and explicit unknown/stale heartbeat/hash/activation-fee evidence.
- [x] 2.3 Test malformed state, history truncation, missing links, stale liveness, hostile arguments and secret-free failures; do not mark full F7 evidence complete.

## 3. Conditional owner payloads

- [x] 3.1 Verify D18 G1/G3 before implementing Guardian product cards; wait final provisioning ABI from add-guardian-position-and-factory for factory-dependent activation sequence. (2026-11-10: D18 decided G1; final ABI in SMART-CONTRACT; implemented in `add-guardian-live-activation-ui` 1.1.)
  - D18 G1 explicitly selected by user on 2026-11-07. Existing-instance owner controls/deactivate/withdraw drafts implemented; final provisioning ABI still pending. User restricted work to this change; factory work is preserved separately and not merged.
- [x] 3.2 Add unsigned deterministic activate/deactivate/withdraw drafts and pause/resume/policy/rotation payloads with existing owner deposit rules and explicit configured fees. (Activation builders added beside the existing owner payloads; fees read from the factory template/Guardian config.)
  - Completed stable existing-instance controls and deactivate/withdraw drafts. Activation intentionally refuses until final provisioning ABI; no guessed creation/funding sequence.
- [x] 3.3 Test stale drafts, altered model prose, registration/funding order, fee recipient binding and deactivated reserve withdrawal. (`test/activation.test.ts`: stale/foreign/locked refusal, registration order, funding bounds, fee-recipient binding; deactivated withdrawal stays in `owner.test.ts`. Builders take no model prose, and `agent/test/guardian.test.ts` covers prose not replacing targets.)
  - Stale/foreign/locked inputs, altered prose/recipient injection, policy bounds, deactivation and full deactivated withdrawal covered. Activation registration/funding/fee order remains gated on final provisioning ABI.

## 4. Verification and documentation

- [x] 4.1 Run guardian-client/agent/engine suites, typecheck and lint; check no signer dependency enters these packages.
- [x] 4.2 Update ARCHITECTURE tool/client/card contracts and P3.1/P4.1/P5.1/P5.2 backend evidence only; preserve missing event-link sources and frontend tasks.
