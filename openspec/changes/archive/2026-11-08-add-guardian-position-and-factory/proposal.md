## Why

A Guardian-held loan cannot be provisioned by the existing scaffold. P2.4/P2.6 need owner-only position operations and keyless creation, conditional on founder custody selection.

## What Changes

- After D18 G1/G3, implement owner collateral/borrow/release/manual-repay/sweep operations.
- Experiment locally with code deployment/storage costs and record the chosen factory strategy before implementing provisioning.
- Create immutable-config keyless Guardians with callback-safe owner mapping and funding/refund handling.
- Prove the complete owner lifecycle and I10 in sandbox.

## Capabilities

### New Capabilities

- `guardian-provisioning`: Owner-controlled Rhea positions and keyless per-owner Guardian creation.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

contracts/guardian, guardian-factory and sandbox tests. Depends on settlement/encoding contracts; client consumes final ABI in a separate change. Implementation must stop before owner methods/factory until D18 is recorded. No public account creation or deployment.
