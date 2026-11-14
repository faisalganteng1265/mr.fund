## Why

P3.1/F7 cannot read Guardian state through a validated client, and P4.1 Guardian card builders remain absent. Existing Rust views must become the client contract rather than unchecked model data.

## What Changes

- Add block-consistent validated views and typed history with explicit evidence gaps.
- Add guardian_status and guardian_history tools using engine/source-number conventions.
- Add deterministic Guardian activation/deactivation/withdrawal cards and owner-control payload builders, conditional on D18.
- Preserve missing heartbeat and transaction-link evidence rather than inventing it.

## Capabilities

### New Capabilities

- `guardian-client-tools`: Validated Guardian reads, factual tools and unsigned owner payloads.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

packages/guardian-client, shared/engine card drafts and agent dispatcher. Reads can start now; action-history integration depends on settlement, provisioning builders on factory ABI, Guardian execution on D18 G1/G3. Excludes forms/panels/wallet signing.
