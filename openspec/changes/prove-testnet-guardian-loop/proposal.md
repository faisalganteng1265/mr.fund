## Why

[V, BUILD-PLAN and INTEGRATIONS, inspected 2026-11-09] Local imported-WASM and public read-only evidence exists, but the live lending/probe loop, factory deployment, first wallet repay and complete Guardian loop remain unchecked. A successful first receipt, sandbox run or synthetic replay cannot prove public settlement or contract-enforced refusal.

## What Changes

- [I, planned evidence only] Sequence BUILD-PLAN **P0.2 Gate 1: can the chosen network run the full lending loop?**, live parts of **P0.3 Gate 2: can a contract own and repay a Rhea loan without anyone's private key?**, **P2.8 Testnet deployment**, **P4.5 First real manual repay**, and **P5.5 Guardian end to end on the D19 network**.
- Require explicit human/network/account/funding/fee/hosting gates before their corresponding operations; retain P0.4/D27 public trigger feasibility and P5.3/P5.4 dependencies.
- Define redacted, reproducible evidence for each transaction, all receipt outcomes, post-state, failure, gas/storage cost and stop decision. Keep planned, tested-locally and exercised-on-network separate.
- Specify observable accepted repayment, over-limit refusal, owner shutdown and reserve/collateral recovery; never mark an unobserved step passing.

## Capabilities

### New Capabilities

- `testnet-guardian-evidence`: A gated evidence protocol for the public testnet lending and Guardian loop.

### Modified Capabilities

None. This change introduces no code, ABI, permission, deployment or founder decision. It does not implement missing wallet, activation, event-linking or watcher runtime work.

## Impact

Only this change's OpenSpec markdown is written now. Future execution records observed evidence in existing INTEGRATIONS recipes 1/3/4/5, SMART-CONTRACT Deployment and BUILD-PLAN Evidence lines in the same evidence commit. There is no claim that a public step has run.

D18 G1 is decided. D19 (network), B7 (accounts/faucet/listed test tokens), D24 (fees) and D29/B8 (host account/cost) remain owner gates. D25/P3.4 GLM acceptance gates chat deployment/F7 transcript acceptance, not a direct read, probe or contract transaction. [U] Current testnet price-update acceptance, usable listed token sourcing, funded accounts and public composed-trigger feasibility remain unproven. Mainnet deployment or transactions always require explicit human authorization for each operation; a testnet failure cannot authorize migration to mainnet.
