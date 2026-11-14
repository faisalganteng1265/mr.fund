## Context

D16 selects a separate Node process. apps/watcher/src/core is scaffolded. evaluateTrigger is deterministic and must remain advisory to the authoritative contract.

## Goals / Non-Goals

Goals: 30-second polling, constrained submission, no duplicate uncertain sends, timestamped heartbeat.
Non-goals: hosting procurement, UI, LLM or creating watcher keys/accounts.

## Decisions

- Inject clock, RPC, validated Guardian registry, reads and request transport into a runtime-neutral loop; Node main owns environment/key loading. One evaluation/request lock per Guardian, fresh snapshots only, no overlap from slow polls.
- Verify network, Guardian config and access-key permission before signing. Receiver is that Guardian, method list exactly request_repay, deposit zero; refuse full-access or broader keys. No owner-method signer API and no agent dependency.
- Back off boundedly on RPC read failures. A submitted hash is reconciled to terminal execution and on-chain state/history before another send. Broadcast timeout after signing is ambiguous: retain signed hash, query it, and suppress new sends. Never blindly resubmit after transport error.
- After restart, validate on-chain in-flight/cooldown and reconcile recent watcher access-key transaction state before enabling requests. If certainty cannot be obtained without durable history, remain read-only and require operator reconciliation; no implicit resend and no new database.
- Log terminal contract rejections without immediate retry. Reevaluate only on the next scheduled fresh-state tick, respecting cooldown and pending state; same unchanged rejection condition must not cause a tight send loop.
- Heartbeat includes observedAt/lastSuccessfulReadAt/lastEvaluationAt and per-Guardian pending/error state; timestamp freshness determines liveness, not process existence. Start with structured stdout logs (allowed P5.3 transport); endpoint integration can consume the same typed status without exposing secrets.
- Local key adapter reads `<WATCHER_KEYS_DIR>/<guardian-id>.json` in near-cli JSON shape (`account_id`, `public_key`, `private_key` or `secret_key`), requires the selected watcher account and derived public key to match, and rejects symlinks and oversized files. It does not provision, rotate or expose keys. A fresh access-key nonce is recorded as evidence but never by itself proves that a prior signed request has settled.
- Over-limit operator script is explicit/manual, never part of polling. Sandbox evidence is local; public submission needs configured accounts/network/permissions and D18/D19/B7. Host deployment waits D29/B8.
- Sandbox execution is isolated from the public runtime: the disposable contract harness starts a local `test-chain-*` node, creates a fresh scoped key, and passes it on stdin to a loopback-only operator. The test resolves the returned signed hash and checks the rejection event, history and balances. This sandbox-only entry has no cross-process reconciliation and is not a public operator; it must never use an existing key or be retried after an uncertain submission.
- An optional single-use local write-ahead barrier for the signer records an intent before signing and syncs the signed hash before broadcast. A present or partial record blocks later attempts; it has no automatic deletion, replay or queue. It is not enabled by the public runtime and cannot establish history before it was installed. Any later integration needs an operator-owned stable shared directory, independent reconciliation and the existing public gates.

Permission boundary: existing per-Guardian function-call key only, request_repay with zero deposit. Invariant W1: at most one unresolved request per Guardian, with no owner authority. Negative tests cover threshold equality, stale state, broad/wrong-receiver key, slow polls, ambiguous broadcast, restart, rejection and RPC backoff. No uptime or liquidation prevention guarantee.

## Risks / Trade-offs

No durable queue in P0 → uncertain restart stops submission until reconciled. Multiple watcher replicas → unsupported initially; operate one instance and document constraint, contract remains authoritative.

## Migration Plan

Test pure loop after client ABI; enable sandbox signing only after settlement/D27 proof. Public operations and hosting are separate gates. Stop process to roll back; do not rotate/delete keys without authorization.

## Open Questions

D18/D19/B7 and D29/B8 remain external. Key source is existing local configuration, never requested in chat.
