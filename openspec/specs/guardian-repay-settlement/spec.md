# guardian-repay-settlement Specification

## Purpose
TBD - created by archiving change complete-guardian-request-settlement. Update Purpose after archive.
## Requirements
### Requirement: Authorized bounded requests

request_repay SHALL accept zero-deposit requests only from stored owner/watcher and enforce active status, a shared in-flight lock, cooldown, positive amount, max action, lifetime cap and reserve floor with checked arithmetic. Rejections MUST be recorded without token movement.

#### Scenario: Above max

- **WHEN** an authorized watcher requests max_per_action + 1
- **THEN** AboveMaxPerAction is recorded and reserve/spend remain unchanged

#### Scenario: Concurrent reads

- **WHEN** one operation is awaiting trigger views
- **THEN** a second request is rejected without scheduling token movement

#### Scenario: Boundary budget

- **WHEN** requested amount plus fee exceeds cap or reserve room by one atomic unit
- **THEN** the request is rejected

### Requirement: Policy-bound fresh trigger and gas feasibility

Preferred automatic repayment SHALL bind health checks to stored policy/config and fresh supported position data, recheck authorization state after reads and execute only strictly below threshold. Integration MUST be gated on measured composed read/repay/resolver/fee callback gas fitting with documented margin on supported versions.

#### Scenario: Threshold equality

- **WHEN** health equals trigger_hf_bps
- **THEN** no repayment is dispatched

#### Scenario: Owner pauses during reads

- **WHEN** Guardian is paused before trigger callback
- **THEN** the callback rejects dispatch and resolves its operation lock consistently

#### Scenario: Gas experiment fails

- **WHEN** any required continuation cannot complete within allocated gas
- **THEN** preferred integration remains blocked and D27 fallback is not silently enabled

### Requirement: Conservative asynchronous settlement

Only private matching single-use callbacks SHALL settle accepted/refunded tokens and fee_charged. The shared lock MUST cover fee settlement; full refunds and failed fees MUST restore only proven refundable amounts. Invalid results MUST NOT create spendable reserve or unlock uncertain obligations.

#### Scenario: Fee transfer failure

- **WHEN** repayment accepts tokens but the fee transfer fails
- **THEN** spent_total includes accepted tokens only, fee reserve is restored and failure is recorded

#### Scenario: Callback replay

- **WHEN** a terminal op id is delivered again
- **THEN** no reserve/spend change occurs

#### Scenario: Malformed resolver

- **WHEN** resolver used amount exceeds the sent amount
- **THEN** no assumed refund is credited and further spending remains blocked pending proven reconciliation

### Requirement: Version and historical truth

Repayment SHALL use verified version-specific encoding with atomic/internal unit checks, without retry fallback. Last-50 history and NEP-297 events MUST distinguish request rejection, started, failed and settled results; accepted spend MUST NOT be described as observed debt decrease.

#### Scenario: Legacy accepted excess

- **WHEN** repayment accepts rounded excess as supplied balance
- **THEN** accounting counts accepted spend conservatively and evidence does not claim all accepted units reduced debt

#### Scenario: Unknown lending version

- **WHEN** the configured version cannot be verified as supported
- **THEN** no token transfer is scheduled
