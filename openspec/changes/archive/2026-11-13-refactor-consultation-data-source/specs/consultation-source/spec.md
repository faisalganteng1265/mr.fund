## ADDED Requirements

### Requirement: Capability ports with declared provenance

The consultation UI SHALL obtain session, position, chat, execution and Guardian data only through typed ports. Every port MUST declare `provenance` as `simulated` or `live`. Presentation components and `useConsultation` MUST NOT import fixture or simulation modules directly. The `Playground` composition root MAY lazily create a demo source when its optional source is absent. The Server Component page selects the serializable `"demo"` source; the existing client `PlayViewport` composition root creates it and passes its port object to `Playground`. This behavior-preserving refactor retains the known unlabelled baseline surfaces documented in design.md; it does not silently add visible copy.

#### Scenario: Demo source is fully simulated

- **WHEN** the consultation renders with the demo source
- **THEN** every port reports `simulated` and every surface that carries a label today renders it through `ProvenanceTag`; unlabelled surfaces are listed as known gaps in design.md

#### Scenario: Mixed provenance stays visible

- **WHEN** a source supplies one `live` port and the other ports are `simulated`
- **THEN** only surfaces fed by the live port omit the simulation label, and surfaces fed by simulated ports keep it

### Requirement: Behavior-preserving demo source

The demo source SHALL reproduce the current playground behavior: fixture position and engine results, scripted replies, mock wallet outcomes (success, cancel, failure, partial), simulated Guardian lifecycle, over-limit rejection, replay and receipts. Visible text, numbers, focus order and keyboard behavior MUST be unchanged by the extraction.

#### Scenario: Existing interaction tests unchanged

- **WHEN** the existing playground interaction tests run without modification after each extraction commit
- **THEN** all of them pass

#### Scenario: Wallet rejection keeps balances

- **WHEN** a simulated wallet cancellation or failure is chosen during repay
- **THEN** balances and debt remain unchanged and the card returns to a draft, as before

### Requirement: Intent-based interface

UI components SHALL change state only by calling intents (connect, send message, execute card, Guardian control). They MUST NOT mutate position, balance, reserve or receipts directly.

#### Scenario: Execution intent is the only repay path

- **WHEN** the user approves a repay card
- **THEN** the UI calls the execution port once and renders the events it emits, and no component updates debt or balance itself

### Requirement: Chat as a protocol-shaped event stream

The chat port SHALL emit events of the same kinds as `POST /api/chat` (`progress`, `text`, `card`, `error`, `done`) so that a live implementation replaces the demo without UI changes. The stream MUST be cancellable through an `AbortSignal`, and cancellation MUST NOT leave a partially rendered reply or a thinking state.

#### Scenario: Cancelled reply

- **WHEN** the user clears the conversation or sends a new question while a reply is in progress
- **THEN** the in-progress stream is aborted and no stale event updates the transcript

### Requirement: No new runtime surface

This change SHALL NOT add dependencies, routes, environment variables, network access, wallet access, storage or signing capability.

#### Scenario: Bundle boundary

- **WHEN** the landing route is built
- **THEN** it imports no module from `apps/web/src/play/source/`, and the production build still completes
