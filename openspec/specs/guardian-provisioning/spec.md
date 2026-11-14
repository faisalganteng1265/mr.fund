# guardian-provisioning Specification

## Purpose

Define how a per-owner, keyless Guardian account is created by the factory, how owner position operations share the Guardian lock, and what the contract does not guarantee.

## Requirements

### Requirement: Custody decision gate

Owner position/factory implementation MUST begin only after founder D18 records G1/G3. G2 MUST stop this change and require rescoping.

#### Scenario: Unresolved custody

- **WHEN** D18 remains open
- **THEN** implementation of P2.4/P2.6 does not begin

### Requirement: Owner-only position lifecycle

Position mutations SHALL require stored owner and 1 yocto, fixed configured Rhea/token targets and operation-bound callbacks. Borrow/release/manual repayment/sweep MUST respect shared locks and exclude reserve and pending obligations from sweep.

#### Scenario: Watcher attempts borrow

- **WHEN** watcher invokes an owner position method
- **THEN** the call fails without state or token movement

#### Scenario: Sweep races settlement

- **WHEN** a token-balance callback arrives while reserve obligations changed
- **THEN** it cannot transfer committed reserve or in-flight/fee funds

### Requirement: Keyless callback-safe provisioning

Factory creation SHALL validate child/config/funding, prevent duplicate pending creation and record owner mapping only after initialization. Created Guardians MUST have no access keys or upgrade method. Failed phases and actual recoverable refunds MUST be reported without duplicate refunds.

#### Scenario: Failed initialization

- **WHEN** child exists but initialization fails
- **THEN** no ready owner mapping is published and committed funding is not described as fully refundable

#### Scenario: Successful creation

- **WHEN** initialization completes
- **THEN** empty access-key list, immutable config and expected code are verified

#### Scenario: Concurrent duplicate

- **WHEN** same owner requests creation while its prior operation is pending
- **THEN** a second child/refund obligation is not created

### Requirement: Measured deployment strategy

Production factory strategy and funding requirements SHALL be chosen only after a pinned-toolchain sandbox experiment measures supported code deployment/storage behavior and failure phases.

#### Scenario: Unproven global deployment

- **WHEN** global-contract strategy has no passing local prototype
- **THEN** factory code does not assume that ABI or publish guessed funding requirements
