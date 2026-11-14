# guardian-client-tools Specification

## Purpose

Define validated Guardian reads, factual tools and unsigned owner payloads.

## Requirements

### Requirement: Validated block-consistent views

The client SHALL parse Guardian status/policy/reserve/history as untrusted data using decimal-string integer bounds, snake_case enums and block/read provenance. Related views MUST share a final block; retained-ring limits MUST be enforced in the backend.

#### Scenario: Malformed u128

- **WHEN** a reserve field is negative or exceeds u128
- **THEN** a typed bad-response error is returned

#### Scenario: Time-filtered history

- **WHEN** guardian_history receives sinceMs and a limit
- **THEN** the backend filters the bounded retained ring and discloses truncation without asking the frontend to filter

### Requirement: Factual awaitable tools

Dispatcher and callers SHALL support awaited Guardian reads. Guardian tools MUST derive numeric facts only from validated evidence and explicitly represent absent heartbeat, transaction hashes, activation dates and historical fees.

#### Scenario: Missing transaction hash

- **WHEN** an Attempt contains op_id but no verified transaction evidence
- **THEN** the tool omits the link and states evidence unavailable

#### Scenario: Stale heartbeat

- **WHEN** last observed watcher timestamp exceeds the liveness bound
- **THEN** the tool reports the timestamp/freshness and does not claim current uptime

### Requirement: Unsigned deterministic owner payloads

Guardian card/builders SHALL use validated fresh engine drafts, fixed trusted targets, explicit fees and actual contract ABI; owner calls MUST attach the specified 1 yocto and no builder/tool may sign. Guardian activation/provisioning execution MUST wait D18 and final factory ABI.

#### Scenario: Hostile model fields

- **WHEN** model prose or arguments attempt to replace recipient or policy amounts
- **THEN** payload bytes remain derived from trusted validated context or the request refuses

#### Scenario: Custody unresolved

- **WHEN** D18 is still open
- **THEN** conditional Guardian activation implementation/execution does not bypass the recorded gate

#### Scenario: Withdraw after deactivation

- **WHEN** the owner requests a valid unused reserve withdrawal
- **THEN** the builder permits the owner flow despite terminal automation state
