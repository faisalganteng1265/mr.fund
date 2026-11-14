## Why

P4.3 has no outcome parser. Immediate promise success and accepted tokens cannot establish that Rhea reduced debt, particularly with detached failures or legacy surplus supplied balances.

## What Changes

- Parse complete NEAR execution receipt graphs and NEP-141 resolution, aggregating repay and fee transactions without hiding partial application.
- Reconcile outcomes with fresh block-provenanced post-state; retain unknown observations explicitly.
- Add recorded sandbox success, refund, surplus, failure and mixed-batch fixtures.
- Exclude wallet connection, signing and receipt UI.

## Capabilities

### New Capabilities

- `repay-outcomes`: Validated transaction outcomes, batch status and independently observed debt changes.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

`packages/rhea/src/outcome.ts`, shared receipt types only as necessary, sandbox fixtures and tests; P4.3 parser portion only. No external credentials or custody decision required. Does not complete real wallet proof or all of P4.3.
