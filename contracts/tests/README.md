# P0.3 sandbox probe

P4.3 outcome recording: ordinary probe cycles capture raw FINAL RPC outcomes,
receipt action details, execution block headers and before/after account views
under ignored `contracts/target/probes/outcomes/`. To regenerate the twelve
tracked fixtures explicitly, run
`RECORD_OUTCOMES=1 cargo test --manifest-path contracts/Cargo.toml -p contract-tests --test probe`.
The partial-refund receiver is a sandbox fixture, not Rhea. No fixture records
public transactions or private keys. See
[REPAY-OUTCOMES](../../docs/technical/REPAY-OUTCOMES.md).

2026-11-07: independent Rust test encoders assert all five shared syntax vectors;
the harness uses them for actual token registration, wallet repayment and fee
transfer. Both imported versions pass partial/full/dust repayment and the exact
borrow risk boundary. Health evidence also compares an actual 0.16.2 liquidation
discount with the shared engine vector; 0.11.0 omits that event field and its
scalar health stays unobserved. Details, limitations and source hashes are in
[PROTOCOL-EVIDENCE](../../docs/technical/PROTOCOL-EVIDENCE.md). The Guardian
repay-message vector proves syntax only: its receiver is not yet implemented.

P0.4 extends these cycles with joined position/config/feed/price reads and shared
Rust/TypeScript health vectors. Null/expired/mismatched-config replies refuse
the trigger. Generated gas files measure only the read-only check; composed
trigger/repay/settlement allocation remains unproven. P2.1/P2.2 also exercise
keyless Guardian activation, owner controls and reserve withdrawal, including
real fee/withdrawal failures from unregistered test-token recipients. Preparation
now builds Guardian too. None of these local checks is a public deployment or
a product pricing decision.

These tests deploy the actual Rhea bytecode downloaded from public testnet and
mainnet into a **local sandbox with new state**. NEP-141 tokens and Pyth prices
are test fixtures; all prices are **Simulated**. This is not a fork of live
positions, a public deployment, or proof that public testnet has usable prices.

From the repository root:

```sh
pnpm contracts:probe:prepare
pnpm contracts:test
cargo clippy --manifest-path contracts/Cargo.toml --all-targets -- -D warnings
```

Preparation needs Node, Rust with `wasm32-unknown-unknown`, `cargo-near`, and
public RPC access. It downloads code, config and an asset template at one final
block per network, then builds the probe and token/oracle fixture with the lockfile.
Tests need a working near-sandbox binary (near-workspaces installs its pinned
version when one is not provided). All generated artifacts stay under ignored
`contracts/target/`. A fresh clone must run preparation before contract tests;
missing artifacts fail explicitly and are never silently skipped.

The harness checks the WASM SHA-256 against its downloaded provenance before
deployment. It initializes Rhea with sandbox owner/token/oracle ids and records
the source version and block. Asset rates are zero in this controlled cycle to
isolate ownership, units and execution behavior from accrued interest.

The probe registers itself on lending and tokens, collateralizes, borrows and
withdraws, repays its own debt, then releases and withdraws collateral. Tests
inspect failed receipts and read back balances/positions. Negative cases cover
non-owner calls, forged callbacks and a different borrower's debt remaining
unchanged. Unit tests cover deposit rules, target restrictions, checked unit
conversion, operation locking and callback failures.

P0.3 discovery: deployed testnet `0.11.0` calls Pyth `get_price(price_identifier)`
and rejects `OnlyRepay`. Its explicit probe alternative is
`probe_repay_via_execute`: NEP-141 `ft_transfer_call` with
`{"Execute":{"actions":[{"Repay":{"token_id":"...","max_amount":"..."}}]}}`.
The outer amount is atomic; inner `Repay.max_amount` is Rhea internal. Strict
`amount` overpayment panics on subatomic debt; the sandbox proves bounded full
repayment and exact excess supplied balance. Accepted tokens do not necessarily
all reduce debt and excess is not assumed refunded.
Mainnet `0.16.2` uses `probe_repay` with `"OnlyRepay"`. There is no automatic
retry or silent fallback. The product builder now requires an observed version
and validated extra decimals, refuses unknown versions, and chooses the matching
message. Complete Rust byte-vector parity is now checked; live wallet proof and
production builder gas remain pending.

Permission boundary: operations require the immutable owner as predecessor and
exactly 1 yoctoNEAR. The probe only registers on its configured lending/token
targets and only transfers configured tokens into its configured lending
contract. Token funding accepts only its owner via a configured token. Callback
results are bounded, private and matched to the pending operation.

Probe invariant P0-I1: a non-owner cannot initiate an operation or choose a
borrower/transfer destination. This exercises the I5/I4 permission pattern but
does not implement Guardian reserve accounting or policy limits. The probe is
throwaway code with a deployment key in sandbox, not a Guardian with I10.
`receipt_succeeded` reports the immediate promise only: Rhea may schedule
detached receipts, so it is never sufficient evidence without outcome traversal
and post-state reads. No audit or liquidation protection is claimed.
