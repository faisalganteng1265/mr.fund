## ADDED Requirements

### Requirement: Fresh deterministic polling

The watcher SHALL poll every 30 seconds, validate fresh Guardian/position state and use evaluateTrigger without importing agent/LLM code. Evaluations/requests MUST NOT overlap per Guardian.

#### Scenario: At threshold

- **WHEN** health is at or above trigger
- **THEN** no request is sent

#### Scenario: Slow RPC

- **WHEN** one poll is still running when the next tick occurs
- **THEN** no overlapping evaluation/send starts

#### Scenario: Stale snapshot

- **WHEN** data fails engine freshness checks
- **THEN** no request is sent and the reason is logged

### Requirement: Constrained signing authority

Runtime signing SHALL refuse keys broader than one configured Guardian receiver and the single request_repay method. Attached deposit MUST be zero; owner methods MUST NOT be available to the transport.

#### Scenario: Broad key

- **WHEN** configured key is full-access or permits another method
- **THEN** submission refuses before signing

#### Scenario: Wrong network

- **WHEN** key/Guardian configuration does not match selected network
- **THEN** submission refuses

### Requirement: Ambiguous requests remain locked

After signing/submission the watcher SHALL reconcile the known hash and on-chain state before another send. Transport ambiguity, restart uncertainty and unresolved execution MUST suppress fresh requests; contract rejections MUST NOT trigger immediate retries.

#### Scenario: Broadcast timeout

- **WHEN** transport times out after signing
- **THEN** the watcher queries the signed hash and never blindly creates another request

#### Scenario: Restart uncertainty

- **WHEN** recent request completion cannot be established at startup
- **THEN** the watcher remains read-only until reconciliation

#### Scenario: Contract rejection

- **WHEN** contract rejects the request
- **THEN** the reason is logged and no immediate send loop occurs

### Requirement: Qualified liveness and gated operation

Heartbeat SHALL carry observation/read/evaluation timestamps and pending/error state without secrets. Public submission MUST wait settlement/D27 evidence and D18/D19/B7; hosting MUST wait D29/B8. The over-limit operator script MUST require explicit invocation outside polling.

#### Scenario: Read outage

- **WHEN** the process runs but RPC reads fail
- **THEN** heartbeat exposes stale last-successful-read rather than claiming healthy monitoring

#### Scenario: Sandbox over-limit test

- **WHEN** operator test requests max_per_action + 1
- **THEN** a real local rejection event/hash is recorded and labelled sandbox evidence
