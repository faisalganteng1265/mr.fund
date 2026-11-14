## Context

guardian-client exports only a manual reserve-repay builder. Rust views use decimal-string U128/U64, snake_case enums and a retained-ring index, not op-id cursor. Agent dispatch currently returns synchronously.

## Goals / Non-Goals

Goals: typed read results, factual F7 tools and unsigned Guardian cards/builders.
Non-goals: UI, signer, indexer/database or claiming complete historical transaction links.

## Decisions

Settlement ABI dependency: `complete-guardian-request-settlement` adds immutable verified lending version, both asset extra decimals, both feed ids and freshness seconds to `GuardianConfig`, `get_config()`, op phase in `in_flight`, tagged RequestOutcome and Unresolved history. Use the concrete ABI in docs/technical/SMART-CONTRACT.md; unresolved means spending remains locked, and `used` means accepted token spend, including supplied surplus. Do not invent a recovery control or accept model-selected configuration.

- Reuse the structural RPC view interface through dependency injection without importing rhea internals; pin all Guardian views to one final block. Validate every field, bound u128 and timestamps, and distinguish not-found, malformed and unavailable results.
- Expose status/policy/reserve/history with block/read provenance. Keep nanoseconds bigint until checked conversion, mapping to engine GuardianState explicitly. History limit <= 50; fetch the bounded retained ring in the backend and apply sinceMs there. State history truncation rather than claiming all-time totals.
- Make dispatch awaitable and migrate every caller/test and provider adapter consistently. Existing synchronous runners remain usable behind the awaitable wrapper; no union requiring callers to guess Promise behavior.
- guardian_status/history construct SourceNumbers from validated output. Heartbeat is an optional timestamped read dependency: absence/staleness means unknown/offline observation, not proof why a historical action did not occur.
- Current history has no tx hash, activation timestamp or activation-fee ledger. Return these as unavailable unless verified transaction/event evidence is supplied and correlated by Guardian/account/network/op id. Never synthesize explorer links from op ids or infer no activity from a truncated ring. Full F7 transaction-link/fee evidence remains open until a real source is connected.
- Guardian card drafts use engine validation/freshness and trusted config; builders own payload bytes. Add activation, deactivate, withdrawal plus pause/resume/policy/rotation unsigned calls using actual Rust ABI and 1-yocto rules. Activation includes storage checks and explicit configured fees; provisioning order follows the factory ABI after D18. Model arguments cannot choose fee recipient, contract targets or versions.
- Reuse the existing engine/shared card flow; distinguish reserve funding from collateral funding. Do not broaden accepted ft_on_transfer messages until provisioning change defines them.

Permission boundary: all reads are public; builders do not sign; owner mutations still require wallet signatures and 1 yocto. Invariant C1: model text cannot change owner payloads or factual numeric values. Negative tests use malformed views, timestamps, truncated history, hostile tool arguments and stale drafts. Does not establish watcher uptime or reconstruct missing transaction history.

## Risks / Trade-offs

Async dispatcher impacts existing callers → atomic migration plus regression suite. Missing evidence limits F7 answers → typed unavailability, not fabricated links or fees.

## Migration Plan

Add view modules and async dispatcher first; implement conditional Guardian cards only after D18 and final factory ABI. Update exports and technical interfaces together, without changing UI.

## Open Questions

Full historical links/activation metadata need verified event/transaction input; no indexer is authorized here. D18 gates Guardian product execution.
