## Why

Guardian reserve lifecycle exists, but P2.3/P2.5/P2.7 automatic request and settlement do not. Read-only trigger gas is insufficient evidence for a transaction that must continue into repay and fee settlement.

## What Changes

- Add policy-gated requests, operation-bound callbacks, bounded history and conservative settlement.
- First prove composed trigger → repay → settlement gas using both supported deployed versions in sandbox.
- Bind trigger checks to stored policy/config and use version-aware repay messages.
- Keep deployment conditional on D18/D19/B7; do not silently select the D27 fallback.

## Capabilities

### New Capabilities

- `guardian-repay-settlement`: Contract authorization, trigger verification and accounted asynchronous repayment.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

contracts/guardian, probe/test harness and SMART-CONTRACT. Depends on protocol encoding evidence. Local core/experiment can proceed; failed gas feasibility blocks preferred integration pending explicit D27 resolution. No owner borrowing/factory or network deployment.
