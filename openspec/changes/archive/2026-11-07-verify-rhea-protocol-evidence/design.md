## Context

P4.2 has five shared encoding vectors, including explicit 0.11.0 Execute/Repay.max_amount and 0.16.2 OnlyRepay. Rust complete parity remains open. Engine exact rational health and deployed intermediate rounding are distinct evidence questions.

## Goals / Non-Goals

Goals: reproducible bytes, deployed behavior and documented numerical tolerance.
Non-goals: public writes, wallet/UI code, changing D19, or replacing every engine function.

## Decisions

- Read fixtures/encodings.json in both suites; compare serialized argument/message bytes, receivers, 1-yocto deposits and atomic/internal conversions. Do not regenerate expected fixtures from the implementation being tested.
- Reuse existing downloaded-WASM SHA/provenance verification and Simulated local token/oracle harness. Exercise legacy max_amount dust, normal partial/full repayment and unknown-version refusal. Syntax parity does not imply deployed execution compatibility.
- Compare TS and Rust health on identical recorded/block-pinned state and boundary vectors; explicitly record intermediate rounding and threshold effects. If discrepancy exceeds 1 bp, add the failing regression and correct the owning math conservatively before accepting parity.
- Public Rhea display comparison records account, time, block context, screenshot/reference and tolerance. A moving display without aligned state is inconclusive; never substitute sandbox parity for P1.4 acceptance.
- Reconcile stale present-tense stack/progress summaries in README, PRD, ARCHITECTURE and INTEGRATIONS against D16 and dated BUILD-PLAN evidence; preserve dated historical observations and unresolved boxes.

Permission boundary: read-only public data and local sandbox keys only. Invariant E1: supported money encodings retain version and unit boundaries. Negative tests alter a vector, version or decimal scale and must fail. Does not guarantee current public oracle usability.

## Risks / Trade-offs

Public display may be unavailable → leave that evidence task unchecked. Protocol upgrades → retain observed version/hash and refuse unknown runtime versions.

## Migration Plan

Add tests/evidence first; change production math only with a demonstrated discrepancy and regression. No deployment or persistent-state migration.

## Open Questions

Exact display capture availability is external. Numerical differences must be measured, not assumed to equal the documented 1-bp target.

## Observed implementation evidence (2026-11-07)

Neither imported WASM exposes a scalar health view. The harness therefore exercises actual risk acceptance at the exact borrow boundary and observes the modern liquidation event's discount: 0.0725 implies 8550 bps, agreeing with the same TS/Rust vector. Legacy 0.11.0 omits that field; no scalar agreement is claimed for it. Published-source fixed-point modeling is recorded separately and differs by 1 bp on two bounded vectors. Full public display parity remains open after the browser host was unavailable. See docs/technical/PROTOCOL-EVIDENCE.md; no change to product math or external decision gates is inferred.
