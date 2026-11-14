## Why

Encoding and rounding evidence remains incomplete across Rust and TypeScript (P1.2/P1.4/P2.7/P4.2), despite working local builders. Protocol-version drift already caused a repay failure.

## What Changes

- Assert every shared encoding vector byte-for-byte in Rust and TypeScript.
- Exercise supported repay variants and rounding boundaries against imported deployed WASM.
- Record engine/deployed rounding differences and perform public read-only display comparison where available; keep missing evidence open.

## Capabilities

### New Capabilities

- `protocol-evidence`: Reproducible cross-language encodings and separately recorded numerical parity.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

Fixtures, contract sandbox tests, engine/rhea tests and technical evidence docs. No public writes or UI implementation. Display availability gates only that evidence, not local encoding tests.
