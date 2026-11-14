## Context

P4.3 owns packages/rhea/src/outcome.ts. CardReceipt currently has submitted/confirmed/failed/partial and observed string values; engine mood consumes observed health before/after. The sandbox already exposes detached Rhea failures and legacy supplied surplus.

## Goals / Non-Goals

Goals: deterministic parsing, complete receipt evidence and honest batch/post-state reporting.
Non-goals: wallet connection, signing, fees retry, UI and full P4.3 completion.

## Decisions

- Separate a pure parser over unknown RPC outcomes from bounded RPC fetching/reconciliation. Validate transaction hash, signer, receiver, methods, amounts and expected batch roles against the trusted unsigned plan; unrelated resolver receipts are not evidence. Use Result and bigint throughout.
- Traverse reachable receipt ids, transaction outcome, failures and resolver return values; bound graph size/depth and reject malformed base64/u128 or impossible used > sent. Missing referenced outcomes/finality remain pending/unknown. Top-level SuccessValue alone is insufficient. Read final execution status explicitly.
- Return per-transaction execution status plus token sent/accepted/refunded and separate post-state observations. Aggregate confirmed only when every required transaction is terminal and successful; mixed success/refund/failure is partial, all ineffective terminal failures are failed, unresolved work remains submitted with explicit reason. Full refund is not a confirmed repay. Preserve any irreversible success when a later transaction is unresolved.
- Keep RPC completion and debt observation independent. Fresh reads at a final block at/after execution must match account/network/lending/token; missing or stale reads leave debt/health unknown rather than inventing them. Before/after debt is an observed delta, not causal attribution when interest or concurrent actions intervene. Surplus supplied is separately observed.
- Preserve the existing CardReceipt statuses through an adapter and put structured parser diagnostics in the parser result. Avoid stuffing unverified observations into mood fields. Record canonical raw outcomes with sandbox provenance.

Permission boundary: read-only parser, no signing/imported keys. Invariant O1: confirmed repayment/debt improvement cannot derive solely from token acceptance. Negative tests cover detached failure, forged/unrelated resolver, missing receipts, overflow, partial fee failure and legacy dust. No guarantee of transaction reversal or causal debt attribution.

## Risks / Trade-offs

Incomplete RPC history → typed pending/unknown and bounded refresh; never retry a transfer. Protocol-specific return semantics → fixtures from both imported versions. Batch non-atomicity → preserve each transaction result.

## Migration Plan

Add parser and receipt adapter, update exports/callers and docs; no database or chain migration. Roll back parser usage without deleting recorded evidence.

## Open Questions

Receipt mapping clarification: execution can be terminal while post-state is unavailable. Keep structured execution evidence, and map an otherwise successful batch to `submitted` until fresh observed debt reduction is available; when tokens were accepted but a valid post-read shows no reduction, map to `partial`. This avoids a confirmed-repayment claim based on token acceptance alone. Observed debt/health changes are not causal attribution.

Public wallet outcome evidence waits for B7/D19 and P4.5; local sandbox fixtures suffice for parser implementation only.
