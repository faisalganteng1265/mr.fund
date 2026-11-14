## Context

P2.1/P2.2 state/reserve operations exist. request_repay, terminal attempt history and fee settlement do not. SMART-CONTRACT draft assumes OnlyRepay everywhere and an immediate promise result; deployed legacy surplus requires more precise disclosures.

## Goals / Non-Goals

Goals: P2.3 core, P2.5 preferred trigger integration and relevant P2.7 invariants/gas evidence.
Non-goals: owner position provisioning, factory, deployment or deciding D18/D19/D24.

## Decisions

- Implement zero-deposit request_repay for stored owner/watcher only. Run documented status/lock/cooldown/amount/max/cap/floor checks with checked u128 arithmetic. Lock an operation before asynchronous trigger reads, covering pending reserve operations too; do not allow concurrent requests through the read phase.
- Bind oracle, asset shape, freshness and strict health threshold to immutable targets and stored policy. Revalidate after joined reads; a pause/deactivation while reads are pending prevents token dispatch. Keep op ids private-callback matched and single-use. Existing owner withdrawal/policy/deposit rules must honor the shared lock.
- Prototype composed joined reads → callback → NEP-141 repay → resolver → fee transfer → fee callback under the transaction limit on both imported versions. Measure allocated and burnt gas per receipt including failure/refund paths and a documented continuation margin. If it cannot fit, stop preferred integration and record B4; no watcher-only fallback without an explicit D27 decision/disclosure.
- Verified deployment configuration must bind lending version and debt extra decimals before sending; unknown/mismatched version refuses. Use 0.11.0 max_amount or 0.16.2 OnlyRepay with explicit units, no fallback retry. Coordinate any additive config ABI change with guardian-client/provisioning proposals.
- Reserve the requested amount and fee while in flight; only finalize used/refunded and spent_total from validated resolver results. Keep lock through the fee callback. Failed fee restores fee reserve and does not increase fee_charged; failed repayment earns no fee. Full refund restores reserve with zero spent. Replayed callbacks cannot credit twice.
- A malformed or impossible resolver result never credits assumed refunds or unlocks spendable funds. Record an unresolved operation and block further spending; implement/test private balance reconciliation only for provable deltas, otherwise leave visibly blocked. No administrative balance overwrite or timeout-based blind unlock.
- Define used as accepted token spend, not debt decrease. Legacy accepted surplus supplied to the Guardian remains disclosed; post-state tests distinguish it. History retains last 50 attempts and reasons, while NEP-297 events retain operation correlation. Record rejections without moving money.

Permission boundary: only owner/watcher requests; only private matched callbacks settle; targets are fixed, and owner controls retain 1 yocto. Invariants I1–I9 apply across all asynchronous phases. Negative tests cover every exact policy boundary, trigger equality, stale/null/future/config mismatch, read failure, duplicate requests/callbacks, pause race, partial/full refunds, fee failure and overflow. No uptime or liquidation-prevention guarantee.

## Risks / Trade-offs

Out-of-gas may strand pending state → prove budgets and fault paths before integration; unresolved settlement blocks further spending. Accepted surplus differs from useful repay → count actual spend conservatively and disclose, never report it as debt paid.

## Migration Plan

Local contract/state ABI changes require rebuild of sandbox instances; nothing is publicly deployed. Update SMART-CONTRACT draft and clients together. No upgrade entrypoint is introduced.

## Open Questions

Composed gas and pathological resolver recovery need experimental evidence. D27 fallback remains unselected; D18/D19/B7 gate public use.
