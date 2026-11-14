## 1. Cross-language encoding evidence

- [x] 1.1 Inventory all shared encoding vectors and their existing TypeScript assertions; add failing Rust byte/deposit/receiver parity tests for every vector.
- [x] 1.2 Add independent Rust serialization paths and validate atomic/internal bounds, unknown versions and no fallback retry.
- [x] 1.3 Run the existing imported-WASM partial/full/dust cycles on both versions and add missing encoding-path assertions.

## 2. Rounding and read-only comparison

- [x] 2.1 Add identical-state TS/Rust health boundary vectors; measure deployed intermediate-rounding differences and add regressions for any discrepancy above 1 bp.
- [x] 2.2 Attempt aligned public read-only Rhea display comparison; record account/block/time/tolerance or leave the evidence explicitly unavailable. No UI code or public write.
- [x] 2.3 Run targeted TS suites, typecheck, lint and affected Rust/sandbox tests with Clippy; record actual results.

## 3. Documentation evidence

- [x] 3.1 Update P1.2/P1.4/P2.7/P4.2 evidence only for the acceptance portions actually observed; keep UI/live portions unchecked.
- [x] 3.2 Reconcile stale present-tense D16/progress summaries in README, PRD, ARCHITECTURE and INTEGRATIONS; preserve dated observations and open decisions.

Evidence: docs/technical/PROTOCOL-EVIDENCE.md and dated BUILD-PLAN updates. Task 2.2 completes the attempt/unavailable branch, not P1.4 UI parity. Task 2.1 reports bounded evidence: modern discount-implied health, both deployed borrow boundaries, shared vectors and a separately labelled published-source model; legacy scalar health remains unobserved. No discrepancy above 1 bp was observed in these checks, and no universal bound is claimed.
