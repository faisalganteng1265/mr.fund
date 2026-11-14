## ADDED Requirements

### Requirement: Complete and attributable execution evidence

The parser SHALL validate unknown input and match outcomes to the trusted transaction plan, traversing all reachable receipts including NEP-141 resolution. Missing/finality-incomplete evidence MUST remain unresolved; malformed or impossible amounts MUST produce a typed error.

#### Scenario: Detached failure

- **WHEN** the immediate promise succeeds but a reachable Rhea receipt fails
- **THEN** the result records the failure and does not report an unqualified confirmed repay

#### Scenario: Incomplete graph

- **WHEN** a referenced receipt or terminal execution status is absent
- **THEN** the result remains pending/unknown and never authorizes a transfer retry

#### Scenario: Unrelated resolver

- **WHEN** another token or transaction has a successful resolver
- **THEN** its return value is not used as evidence for the planned repay

### Requirement: Independent token and debt observations

The result SHALL distinguish sent, accepted and refunded token amounts from observed debt delta and supplied surplus. Fresh post-state MUST match network/account/lending/token and be read at or after terminal execution; unavailable observations MUST stay unknown.

#### Scenario: Legacy surplus

- **WHEN** a legacy full repayment accepts tokens and supplies the rounded excess
- **THEN** accepted spend, debt observation and supplied surplus are reported separately

#### Scenario: Read failure after execution

- **WHEN** execution is final but the fresh position read fails
- **THEN** execution evidence remains available while health/debt improvement stays unknown

### Requirement: Honest batch receipt mapping

The adapter SHALL preserve the existing CardReceipt statuses and per-transaction outcomes. Confirmed requires all required actions terminal and successful with effective repayment; a full refund MUST NOT be reported as a confirmed repayment.

#### Scenario: Fee failure

- **WHEN** repay succeeds and the separate fee transaction fails
- **THEN** the aggregate is partial and preserves the successful repay hash

#### Scenario: Unresolved later transaction

- **WHEN** one batch transaction succeeds and another is unresolved
- **THEN** the result preserves applied effects and marks overall completion unresolved

#### Scenario: Complete refund

- **WHEN** the resolver refunds the full repayment amount
- **THEN** the receipt records zero accepted spend without claiming debt improvement
