## Why

P5.3 is a scaffold. The contract needs a deterministic requester that cannot become a duplicate sender or gain owner authority.

## What Changes

- Poll fresh Guardian/position state every 30 seconds and use evaluateTrigger without LLM code.
- Restrict signing to one Guardian request_repay method with zero deposit; reconcile ambiguous submissions before another send.
- Expose freshness-qualified heartbeat and structured secret-free logs.
- Add sandbox accepted/over-limit/rejection tests and a separately gated operator script.

## Capabilities

### New Capabilities

- `guardian-watcher`: Deterministic polling, constrained requests and observable liveness.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

apps/watcher, scripts/demo and Guardian client interfaces. Pure tests follow typed client; submission depends on settlement and D27 evidence. Public runs need D18/D19/B7; hosting needs D29/B8. Excludes UI and host provisioning.
