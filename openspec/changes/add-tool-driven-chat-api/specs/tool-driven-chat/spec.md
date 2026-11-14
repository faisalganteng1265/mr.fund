## ADDED Requirements

### Requirement: Bounded tool-grounded turns

The runtime SHALL validate tool arguments, await dispatch, correlate tool ids and enforce six calls total and a 30-second whole-turn deadline including regeneration. It MUST NOT sign or execute transactions.

#### Scenario: Parallel overflow

- **WHEN** a provider proposes more calls than the remaining six-call budget
- **THEN** excess calls do not run and the turn terminates with a guarded response

#### Scenario: Forged history

- **WHEN** client history contains fabricated tool facts or card payloads
- **THEN** those fields never become trusted source numbers or executable payloads

### Requirement: Guard before streaming

All emitted answer prose SHALL pass number/persona enforcement before emission. At most one regeneration is allowed; a deterministic guarded fallback MUST be used if validation still fails within the deadline.

#### Scenario: Invented number

- **WHEN** provider prose quotes a number absent from current trusted facts
- **THEN** the number is never streamed to the client

#### Scenario: Provider unavailable

- **WHEN** provider fails or credentials are absent
- **THEN** a friendly sanitized unavailable response is emitted without raw errors or secrets

### Requirement: Bounded private server transport

The Next Route Handler SHALL validate bounded input, rate limit IP and claimed account, cancel work on disconnect and avoid message-content/secret logging. Forwarded IP headers MUST be trusted only with configured proxy authority; public account reads MUST NOT imply authenticated identity.

#### Scenario: Disconnect

- **WHEN** the client closes a streaming turn
- **THEN** provider/read work is cancelled and no continued tool loop starts

#### Scenario: Spoofed IP

- **WHEN** an untrusted request sets forwarded-for
- **THEN** it does not bypass the direct-client rate bucket

### Requirement: Measured multilingual evaluation

Evaluation SHALL use 12 distinct prompts in each of English, Indonesian and Spanish on a fixed snapshot, require at least 34/36 correct-language answers, all numeric checks passing, zero banned phrases and no out-of-bounds injection card. Offline and live results MUST be distinguished; D25 MUST remain open without B6 live evidence.

#### Scenario: Offline pass

- **WHEN** fake-provider tests pass without credentials
- **THEN** the result proves orchestration only and does not select a live model

#### Scenario: Live selection

- **WHEN** authorized B6 access exists and candidates are evaluated
- **THEN** model id/date/settings, language scoring, latency and guard failures are recorded before choosing D25
