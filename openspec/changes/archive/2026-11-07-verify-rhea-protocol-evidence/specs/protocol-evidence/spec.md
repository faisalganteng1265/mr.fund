## ADDED Requirements

### Requirement: Cross-language byte parity

Rust and TypeScript suites SHALL independently assert every fixtures/encodings.json vector including version-specific messages, deposits and unit boundaries.

#### Scenario: Altered encoding

- **WHEN** a message byte, receiver, deposit or amount scale changes
- **THEN** the owning parity test fails rather than regenerating the expectation

### Requirement: Deployed version behavior

Sandbox tests SHALL verify imported WASM provenance and exercise each supported version's repay path including partial/full/dust cases. Unknown versions MUST refuse without a fallback retry.

#### Scenario: Legacy dust

- **WHEN** atomic-ceiled repayment exceeds legacy internal debt
- **THEN** max_amount clears the debt and exact accepted supplied surplus is checked

#### Scenario: Unknown version

- **WHEN** configuration contains an unsupported version
- **THEN** no repay payload is produced

### Requirement: Separate numerical evidence gates

Health evidence SHALL compare identical input state, record rounding/tolerance and distinguish deployed sandbox parity from public display parity. Differences above 1 bp MUST block acceptance pending regression and correction.

#### Scenario: Display unavailable

- **WHEN** public account display cannot be aligned or captured
- **THEN** P1.4 display evidence remains unchecked even if local parity passes

#### Scenario: Fixed prices

- **WHEN** local prices are controlled fixtures
- **THEN** results are labelled Simulated and not public network evidence
