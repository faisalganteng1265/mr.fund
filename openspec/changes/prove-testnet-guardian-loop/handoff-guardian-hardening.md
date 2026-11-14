# Handoff: Guardian rounding fix and testnet factory deploy (stopped unfinished)

Written 2026-11-13 by the lead when the build workers were stopped (Codex quota exhausted). Nothing in this file is a deployment or a passing result. Labels: [V] observed with date, [I] design, [U] unknown or not run.

## Status in one line

Tasks 4.1 and 4.3 are not started on chain. No Guardian or factory wasm was built for deployment, no factory was deployed, no `create_guardian` was called, no fee recipient was registered. `contracts/guardian/src/*` is unchanged.

## Why this work exists

[I, from code reading] `owner_borrow` and `owner_withdraw_collateral` in `contracts/guardian/src/position.rs` pair `Borrow(x)` with an exact `Withdraw(x)`. On a Rhea pool whose share price is not 1 (any pool with accrued interest) the exact withdraw rounds in shares and can revert, which would strand the owner's borrow or release. [U] The defect has not been reproduced: the failing-first test below was never observed failing.

Planned fix: omit the `Withdraw` amount so Rhea withdraws the whole supplied balance, keep `Borrow`/`DecreaseCollateral` bounded by the owner's amount, keep the public ABI and the shared operation lock. Rhea supplied excess is not booked reserve; invariants I4 and I8 and the debt-token sweep exclusion must still hold (surplus pulled by a later borrow is never rebooked into reserve).

## Unfinished work product

`handoff-rounding-sandbox.patch` (in this directory) is the uncommitted work in the stopped worker's worktree, applying cleanly on `dev` as of this commit:

- `contracts/tests/tests/support/rounding_flow.rs` (new, about 100 lines): an imported-Rhea-0.11.0 sandbox flow with interest accrual; asserts both pools have a share price above one, then runs three cases: `release` (withdraw 50_000_000 collateral, received within 49_999_998..=50_000_000, reserve 0), `borrow`, and `surplus` (repay surplus then borrow, reserve stays 20_000_000, sweep never touches booked reserve, second sweep drains nothing).
- `contracts/tests/tests/probe.rs`: `cycle` becomes `cycle_with_rounding`, skips the 100% utilization override when a rounding case is set, and adds tests `guardian_accrued_borrow`, `guardian_accrued_release`, `guardian_accrued_surplus_then_borrow`.
- `contracts/guardian/Cargo.toml`: `reproducible_build` metadata with a `sourcescan/cargo-near:0.22.0-rust-1.99.1` image and a digest. [U] The image tag and digest were not pulled or verified; Docker Desktop's engine was stopped. Verify before relying on them.

[U] None of this was compiled or run to completion in this repository's CI context. A worker had copied the tree to a WSL clone (`~/build/mrfund-worker-e`, ext4) to run it; no results were recorded. The harness helpers used (`call`, `position`, `balance`, `target`) are the existing ones in `probe.rs`.

The D24 fee decision from the same worker is already merged into `docs/OPEN-DECISIONS.md` (owner-approved, see below); it is not part of the patch.

## Verified facts to reuse (all [V] testnet unless noted)

- Rhea lending `contract.1689937928.burrow.testnet`, version `0.11.0`, `pyth_oracle_account_id: pyth-oracle.testnet`, price validity 60 s. Final block 277467441 (`5DJ8Mk2DSuFY3CWmnrZijwqPp64cadMAw7jj9h5nm1V4`), 2026-11-13.
- Price feasibility: `wrap.testnet` default price `{multiplier 960, decimals 26}`; `ref.fakes.testnet` default price `{multiplier 250, decimals 20}` (token decimals 18, so 2.50 USD per REF, fixed). `usdc.fakes.testnet` has no default price and a stale oracle price, so it cannot be the Guardian debt token on testnet. Guardian debt token is therefore `ref.fakes.testnet`.
- Owner-approved fees (2026-11-13), recorded in D24: activation 0.4 REF = `400000000000000000` (immutable in the factory template), per automatic action 0.004 REF = `4000000000000000`, manual execution 0.01 USDC.e = `10000`. Recipient `fee-mrf-b1ce96af6a.testnet`; it must be registered on `ref.fakes.testnet` with its own key before the first fee.
- Accounts (public ids): deployer `mrf-b1ce96af6a.testnet`, factory `f-mrf-b1ce96af6a.testnet` (no code, 10 NEAR), watcher `w-mrf-b1ce96af6a.testnet` (full-access key only), demo user `d-mrf-b1ce96af6a.testnet`, fee recipient `fee-mrf-b1ce96af6a.testnet`, probe `p-mrf-b1ce96af6a.testnet`. Keys live only in the gitignored `.env`.
- Demo user after the owner-authorized wrap (tx `GGCPNQVKz1EQcTqzLwCrGBD9D2kh4kA47e9B6fkT47mW`, FINAL): 15.5 wNEAR, 12.9159 REF, 27801.099472 USDC.e, Rhea position empty.

## Order of remaining work (keep this order)

1. Reproduce the rounding defect: run the three `guardian_accrued_*` tests against the unchanged Guardian in WSL on ext4 (not `/mnt/c`); keep failing output as evidence. If they pass unchanged, the defect is not real on 0.11.0 and the fix is unnecessary; record that instead.
2. Apply the fix; full `cargo test` in `contracts/`; update SMART-CONTRACT and LESSONS in the same commit.
3. Build the Guardian wasm (reproducible needs Docker running; otherwise label it non-reproducible), freeze it, embed it in the factory, record SHA-256, code hashes, sizes, tool versions. The factory has no code setter, so freeze before deploying.
4. Deploy and init the factory at `f-mrf-b1ce96af6a.testnet` with REF activation and action fees, register the fee recipient on `ref.fakes.testnet`, verify every factory view. **Do not call `create_guardian`**: the owner creates the Guardian from the UI with `d-mrf-b1ce96af6a.testnet`.
5. Only then Gate 2 (tasks 3.1/3.2) and the owner-signed loop (4.2, 4.3, 5.x).

## Env values this work must end with

Names only; set values after verification: `GUARDIAN_FACTORY_ID`, `NEXT_PUBLIC_GUARDIAN_FACTORY_ID`, `NEXT_PUBLIC_GUARDIAN_ACTION_FEE_ATOMIC=4000000000000000` (currently still the USDC value `10000`), `WATCHER_KEYS_DIR`. See also D25 for `NEARAI_MODEL` and the RPC recommendation in CHAT-API.

## Constraints that still apply

Mainnet, real funds, account creation and public posts need explicit owner approval. The watcher account must not submit publicly until a scoped function-call key exists. Hosting for the watcher (D29/B8) is undecided.
