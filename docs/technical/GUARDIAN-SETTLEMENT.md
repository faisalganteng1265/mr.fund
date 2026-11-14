# Guardian settlement work — local feasibility first

Status: composed local feasibility demonstrated on imported Rhea 0.11.0 and 0.16.2 (2026-11-07). Imported bytecode runs in new sandbox state with standard test tokens and Simulated prices. This is not public deployment or production token/oracle performance evidence. D18/D19/B7 remain external gates; no watcher-only D27 fallback has been selected.

## Accounting and permission cases

| Boundary | Existing mechanism | Required automatic-action evidence |
| --- | --- | --- |
| I1/I2/I3 | Validated policy, checked reserve updates | Amount/fee at exact max, cap and floor; reject one atomic unit beyond |
| I4/I5 | Fixed targets; owner + 1 yocto controls | Owner/watcher only, zero-deposit request; verified version/extra decimals; private matched callbacks |
| I6 | Shared in-flight reservation and pending reserve operation | Lock before trigger reads through fee callback; deposit/withdraw/policy races; duplicate callback |
| I7 | Pause/deactivate owner controls | Pause or deactivate during trigger reads must prevent token dispatch |
| I8 | Resolver-based reserve lifecycle | Accepted/refunded spend, full refund, token failure, fee failure, malformed result without assumed credit |
| I9 | Owner withdrawal in every status, unless locked | No new lock bypass or fabricated recovery; ambiguous settlement remains visibly blocked |

The existing syntax vectors are asserted independently in Rust and TypeScript (see PROTOCOL-EVIDENCE). Automatic integration must additionally bind runtime version/config, validate fresh trigger inputs and prove continuation allocation. Used means accepted token spend, never an asserted debt decrease. Unregistered recipients and reverted token actions must be checked through final receipts and physical balances.

## Composed budgets and evidence

Root request: 300 Tgas, explicitly passed to the local transaction (the sandbox's larger maximum is not used for this proof). Eight views reserve 75 Tgas; trigger callback reserves 160. Trigger callback schedules token repayment at 85 plus settlement at 40. Settlement schedules fee transfer at 10 plus final callback at 10. Unused-gas weights are zero in this experimental path. Allocated and burnt gas, actual child reservations, final balances and every failed receipt must be recorded before declaring the gate passed.

The native SDK unit test checks receipt structure with a larger mock budget; it is not feasibility evidence. The imported-WASM sandbox transactions independently enforce the 300 Tgas limit. NEP-141 token internals may allocate remaining gas by weight; reports include their actual child allocations too.

This throwaway owner-funded probe does not implement Guardian policy authority, reserve bookkeeping, owner position methods or a factory. A passed prototype is followed by equivalent production-path tests; a failed feasibility gate stops preferred integration and records B4 rather than choosing the watcher-only fallback silently.

Both imported versions pass the prototype's success, intentional receiver rejection/full refund, insufficient-token transfer failure and unregistered fee-recipient failure. Tests assert the exact final status and failed method; gas failures cannot stand in for the intended fault. Physical token balances and Rhea debt deltas independently match the resolver. Reports include receipt ids, targets, status/error, allocated gas, burnt gas, child allocations and remaining margin.

| Guardian/probe receipt | Allocation (Tgas) | Observed remaining margin after burn and child reservations |
| --- | ---: | ---: |
| Root | 300 | >59 Tgas |
| Trigger callback | 160 | >31 Tgas |
| Repay resolver callback with fee continuation | 40 | >17 Tgas |
| Fee callback | 10 | >8 Tgas |

The harness requires at least 2 Tgas of continuation margin on every Guardian/probe receipt. Token internals forward their excess by weight, so their small unallocated remainder is not a Guardian continuation budget. The fixture token's resolver retains its own 5 Tgas allocation. These measurements must be repeated with the eventual production token/oracle and selected network before public use.

Actual Guardian imported-version scenarios separately exercise authorization/policy, a keyless account, accepted repayment, fee failure and cooldown. Positions are seeded with the throwaway probe and sandbox code/STATE patching from a fresh Guardian, then all account keys are removed; no production provisioning or upgrade method is introduced. A controlled oracle fixture acts as Guardian owner and performs `pause` while a joined price read is pending; `repay_requested` occurs, `repay_started` does not, the callback rejects NotActive, token/debt balances remain unchanged and the lock clears. This is a deterministic pause race, not a request that began while already paused.

Imported Guardian overpayment checks accept 5,000,000 atomic units against 4,000,000 atomic units of debt, clear borrowed balance and retain exactly 1,000,000 atomic units (10^18 internal units) as supplied balance on both versions. Cumulative spend includes all accepted tokens plus actual fees. A controlled receiver's 50% refund is not substituted for this deployed-code surplus behavior.

Partial/full-refund accounting uses a **controlled receiver**, with both message encodings and real NEP-141 token/resolver mechanics. These scenarios are deliberately not described as deployed Rhea returning partial refunds: imported Rhea can accept overpayment into supplied balance. The controlled fixture proves reserve/history/fee bookkeeping; imported-version post-state proves lending behavior separately. A failed outer repayment promise is treated more conservatively by Guardian than the throwaway probe: it stays Unresolved because failure alone cannot prove a refund.

## Reproduce and inspect

Build the local probe, Guardian and fixture WASM with `cargo near build non-reproducible-wasm --manifest-path contracts/<package>/Cargo.toml --no-abi --locked` (fixture package is `contracts/tests/fixtures`). Imported binaries and provenance are prepared by `pnpm contracts:probe:prepare`; this preparation only reads public deployed code/config and creates local sandbox artifacts.

Run `cargo test --manifest-path contracts/Cargo.toml`. The integration harness writes ignored evidence under `contracts/target/probes/`: `composed-gas-{network}-{scenario}.json` and `guardian-gas-{network}-{scenario}.json`. Imported provenance is checked by SHA-256 before deployment: testnet source block 276446382, mainnet source block 223272972. Production code always derives encoding from its immutable configured version and verifies that version at runtime.

Final verification (2026-11-07): full Rust workspace passes 53 tests (28 Guardian, 12 probe, 6 shared trigger, 2 encoding, 4 sandbox/provenance and 1 existing factory scaffold). `cargo clippy --manifest-path contracts/Cargo.toml --workspace --all-targets -- -D warnings` passes. `pnpm test` passes 525 tests with 1 opt-in live test skipped; workspace typecheck and Biome pass. Independent read-only review found no Critical/Important issue; its receipt failure-provenance and history timestamp findings were addressed before completion.

## Remaining boundaries

Unresolved settlement intentionally has no reconciliation or administrative unlock: neither a timeout nor an arbitrary balance observation proves a safe reserve delta, especially with unbooked borrowed tokens or unsolicited transfers. Known accepted spend remains recorded; unknown refunds and fees remain unavailable. Public deployment requires explicit review of this operational limitation. Owner position methods, sweep, factory provisioning and watcher operation remain separate changes. D18/D19/B7 and D24 pricing remain open; this change does not complete all P2.7 invariants or public P0.3.
