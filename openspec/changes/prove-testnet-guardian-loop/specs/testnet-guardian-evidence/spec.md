## ADDED Requirements

### Requirement: Explicit authorization precedes public operations

[I, planned] Execution SHALL enforce design.md's D19, B7, D24, D27 and D29/B8 gates. Testnet probe/deploy authorization MUST NOT imply account creation, login or real-fund spending authority. Every mainnet deployment/transaction MUST have explicit human authorization for that operation. D25/P3.4 SHALL gate deployed chat/F7 acceptance, not direct reads/contracts.

#### Scenario: Accounts are missing

- **WHEN** B7 account ids, balances or listed-token access have not been established
- **THEN** dependent public writes remain unchecked until the human supplies accounts or explicitly authorizes their creation

#### Scenario: Testnet gate fails

- **WHEN** testnet prices, borrowing or deployment fail
- **THEN** the failure is recorded and presented to the founder under D19 without automatic mainnet migration or real-fund spending

#### Scenario: Host or model gate remains open

- **WHEN** D29/B8 hosting or D25/P3.4 acceptance is unresolved
- **THEN** hosted-watcher or deployed-chat acceptance respectively remains open while independently authorized probe/read evidence can proceed

### Requirement: Recorded evidence is reproducible and secret-free

Records SHALL follow design.md's format: BUILD-PLAN id, actor/authorization, UTC times, network/accounts, versions/hashes, redacted commands, blocks, outcomes and recovery. Transactions MUST include final hashes, verified explorer links, all receipts and before/after FINAL state. Records MUST distinguish planned, tested-locally and exercised-on-network. Secrets MUST NOT appear in evidence.

#### Scenario: No transaction occurred

- **WHEN** a step is a read-only view or an unsigned/cancelled action
- **THEN** evidence says no transaction and records view block provenance or cancellation rather than inventing a receipt link

#### Scenario: Command exposes a credential

- **WHEN** captured commands, logs or screenshots contain secret material
- **THEN** publication stops and the record is redacted/reviewed before storage or commit, with any exposure escalated to its owner

#### Scenario: Failed run precedes a later success

- **WHEN** a later attempt succeeds after an earlier failure
- **THEN** both dated observations remain recorded and the failure is not silently replaced

### Requirement: Gate 1 is observed on the actual lending network

P0.2 Gate 1: can the chosen network run the full lending loop? SHALL be recorded only after the actual asset flags/units/price mappings, token sourcing and full plain-account registration→collateral supply→borrow→withdraw→repay→release→withdraw cycle have been observed. A full pass MUST include fresh usable mapped prices and finalized transactions/post-state per write. Fixed-price-only operation SHALL be classified partial pass, with price-driven beats labelled Simulated, and referred to D19.

#### Scenario: Price update is accepted

- **WHEN** an authorized mapped-feed update yields a non-null fresh price and the full lending cycle settles
- **THEN** hashes, blocks, current price timestamps and per-step get_account results may support a full Gate 1 pass

#### Scenario: Price update is rejected or unknown

- **WHEN** update ABI/fee/source is unverified or the live update fails
- **THEN** no guessed update is submitted, or the observed failure is recorded, and fresh-price borrowing is not claimed

### Requirement: Live contract ownership proof is separate from sandbox proof

Live P0.3 SHALL require the probe's public lending cycle, debt attribution, token destination, non-owner rejection and no repayment of another account's debt. Version selection MUST be verified: recorded 0.11.0 uses bounded Execute/Repay.max_amount; recorded 0.16.2 accepts OnlyRepay. Unknown versions MUST stop without encoding retries.

#### Scenario: Imported WASM passes locally

- **WHEN** sandbox tests complete against imported deployed bytecode with Simulated prices
- **THEN** records are labelled tested-locally and live P0.3 stays unchecked until the separate public cycle is observed

#### Scenario: Different-account debt

- **WHEN** the probe repays as itself while another account has recorded debt
- **THEN** final state proves the probe's attribution and no reduction of the other account's debt from that action, accounting for independently observed accrual

### Requirement: Deployment proves current artifact and keyless ownership

P2.8 Testnet deployment SHALL require the reproducible build, deployed factory, actual create_guardian({policy}) ABI, terminal creation callback/mapping, current code hashes, owner and empty Guardian access-key list. Funding bounds, registration and immutable template SHALL be verified for the actual build, not copied as timeless constants from sandbox evidence.

#### Scenario: Creation returns only a hash

- **WHEN** a submitted factory transaction has not yet produced a terminal created outcome and verified mapping
- **THEN** no ready Guardian is claimed and deployment acceptance remains open

#### Scenario: Creation fails

- **WHEN** the creation batch fails
- **THEN** evidence records child/mapping state and observed sent/claimable refund, and any authorized claim_refund is tracked separately without promising refunded gas

### Requirement: First wallet repay proves the actual product flow

P4.5 First real manual repay SHALL require ask→card→Execute now→real wallet approval→observed receipt on the D19 network and fresh chain-derived debt/health after the action. All receipts MUST be reconciled; token acceptance, supplied surplus and debt reduction SHALL remain distinct. CLI/manual Guardian reserve repayment MUST NOT substitute for the wallet-loan product acceptance.

#### Scenario: Wallet cancels

- **WHEN** the human declines wallet approval before submission
- **THEN** cancellation is recorded without a transaction hash or completed P4.5 claim

#### Scenario: First receipt succeeds but a child or fee fails

- **WHEN** an outer transaction succeeds but downstream receipts fail or the separate fee transaction fails
- **THEN** evidence exposes each applied/failed part and does not report an unqualified confirmed repay from top-level success alone

### Requirement: Guardian acceptance proves bounded execution and refusal

P5.5 Guardian end to end on the D19 network SHALL require activation, one settled bounded repay, authorized max_per_action+1 refusal, F7 questions 1–8 grounded in real contract state/history, pause, deactivation and reserve/collateral recovery. P5.3/P5.4 observations MUST distinguish watcher operation from an explicitly invoked operator test. A replay SHALL be labelled Simulated and MUST NOT bypass the contract's actual trigger check; sandbox-only repayment SHALL NOT satisfy public acceptance.

#### Scenario: Accepted bounded repay

- **WHEN** fresh actual-chain health is below trigger, policy/cooldown/reserve permit the request and all callbacks complete
- **THEN** final state proves actual debt change, reserve/spent/fee accounting and no overlapping operation, with transaction/event correlation

#### Scenario: Over-limit operator request

- **WHEN** an authorized caller explicitly requests max_per_action+1 with earlier status/in-flight/cooldown checks clear
- **THEN** the record contains AboveMaxPerAction, request_rejected and history correlation, finalized explorer link, no repay movement and the label operator test request

#### Scenario: Simulated watcher price cannot satisfy the chain

- **WHEN** a replay predicts a trigger but the preferred deployed Guardian does not observe below-trigger actual prices
- **THEN** acceptance remains blocked and the refusal is recorded without price overrides, implicit D27 fallback or a false bounded-success claim

#### Scenario: F7 link or activation history unavailable

- **WHEN** bounded history has no verified transaction linkage or activation fee ledger
- **THEN** the answer states the missing information and complete F7 acceptance stays open rather than inventing links or fee totals

### Requirement: Owner stop and recovery respect the deployed authority

Money steps SHALL state boundary, SMART-CONTRACT I1–I10, negative tests and limits per design.md. Automatic calls MUST use only scoped existing request_repay authority, fixed receiver, finite allowance and zero deposit. Owner controls MUST require owner plus 1 yocto. Stopping SHALL halt submissions, reconcile hashes, pause/deactivate and withdraw only unlocked assets after debt/release checks.

#### Scenario: Locked or unresolved repayment

- **WHEN** repayment outcome remains Unresolved or an action is still in flight
- **THEN** no administrative unlock, guessed refund, repeated repay or promised withdrawal is recorded; the lock/blocker and owner recovery limits remain explicit

#### Scenario: Deactivated Guardian

- **WHEN** the owner deactivates with no pending operation and withdraws unlocked reserve
- **THEN** public final state demonstrates automation disabled and actual returned tokens, while locked NEAR/storage and any unreleased collateral remain separately disclosed

### Requirement: Measured costs and observed completion only

Execution SHALL capture per-receipt gas/reservations, total burnt costs, storage/balance/stake deltas and registration costs for the actual artifact. Testnet and sandbox measurements MUST remain separate from inferred mainnet pricing; founder D24 approval SHALL remain explicit. BUILD-PLAN boxes and owning docs MUST be updated only with observed evidence satisfying each named acceptance, never because this evidence plan or local tests exist.

#### Scenario: Unrun or incomplete step

- **WHEN** a command was not run, receipts/post-state are missing or a required human gate is open
- **THEN** its task remains unchecked with planned/[U] status and its exact missing prerequisite and owner

#### Scenario: Pricing proposal after measurement

- **WHEN** public testnet costs are captured
- **THEN** D24 receives sourced measurements plus separately labelled inferred mainnet assumptions, and no fee/mainnet transaction is automatically approved
