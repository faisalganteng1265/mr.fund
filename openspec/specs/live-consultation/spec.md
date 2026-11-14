# live-consultation Specification

## Purpose

Connect the consultation chat to the tool-driven chat API for a live wallet account: stream events, cancellation, failure states and number provenance.

## Requirements

### Requirement: Live chat stream client

The consultation SHALL send questions to `POST /api/chat` for the active session account and render the SSE events `progress`, `text`, `card`, `error` and `done` as the chat port's protocol events. The client MUST ignore unknown event kinds, MUST treat malformed JSON in a known event as a failed turn, and MUST handle UTF-8 and frame boundaries that split across network chunks.

#### Scenario: Chunk boundary inside a multibyte character

- **WHEN** an SSE chunk ends in the middle of a multibyte character or event line
- **THEN** the completed event is delivered once with the correct text

#### Scenario: Stream ends without done

- **WHEN** the stream closes before a `done` event
- **THEN** partial text is discarded, an interrupted state with Retry is shown, and no answer is recorded in history

### Requirement: Cancellable turns

Each chat turn SHALL be cancellable. Sending a new message, clearing the conversation or leaving the screen MUST abort the in-flight request, and no later event from an aborted turn may change the transcript.

#### Scenario: New message during a reply

- **WHEN** the user sends another message while a reply is streaming
- **THEN** the first request is aborted and only the new turn updates the transcript

### Requirement: Request bounds follow the server contract

The client SHALL send at most 20 history messages totalling at most 16 000 characters, each at most 4 000 characters, drop the oldest messages first, refuse to send an empty message or one over 4 000 characters, and send `locale` only when it is `en`, `id` or `es`.

#### Scenario: Long conversation

- **WHEN** the transcript exceeds either history limit
- **THEN** the request contains only the most recent messages within both limits and succeeds without a 400

### Requirement: Recoverable failure states

The UI SHALL map HTTP 400, HTTP 429, other HTTP/network failures, `error` events and interrupted streams to distinct plain-language states with a recovery action, SHALL preserve the user's message for resend, and MUST NOT display raw server text, stack traces or prompt content.

#### Scenario: Rate limited

- **WHEN** the server answers `429 rate_limited`
- **THEN** the UI shows a rate-limit notice, keeps the message, and does not retry automatically

#### Scenario: Assistant not configured

- **WHEN** the server reports the assistant unavailable
- **THEN** the UI states that the assistant is unavailable and the position view remains usable

### Requirement: Deterministic numbers only

The UI SHALL display financial values only from card payloads, position responses and other structured tool results, formatted from integer atomic units without floating-point arithmetic. It MUST NOT derive, recompute or modify numbers found in assistant text.

#### Scenario: Formatter boundaries

- **WHEN** zero, six-decimal, 24-decimal and very large atomic amounts are formatted
- **THEN** the displayed decimals are exact and conservative rounding is applied only where the server specified it

#### Scenario: Number in assistant text

- **WHEN** assistant text contains a number
- **THEN** it is displayed as text and no UI state is computed from it

### Requirement: Live position with network and age checks

For a real session the position surface SHALL read `POST /api/position`, show the response's data age, and refuse to display a response whose `networkId` differs from the session network. A stale position MUST disable card actions and offer an explicit refresh; there SHALL be no hidden retry or background polling.

#### Scenario: Network mismatch

- **WHEN** the position response `networkId` differs from the wallet network
- **THEN** the UI shows a network-mismatch error, shows no position values and disables chat

#### Scenario: Account without a position

- **WHEN** the response reports no position
- **THEN** the UI shows an explicit empty state and chat remains available for general questions

### Requirement: Non-executing cards

A `card` event SHALL render its title, reason, numbers, fees and a summary of the unsigned action. Until wallet execution is delivered the Execute control MUST be disabled with a stated reason, and the UI MUST NOT show a success, pending or receipt state for it.

#### Scenario: Card rendered from a stream

- **WHEN** a `card` event arrives
- **THEN** the card shows its server-provided values and Execute is disabled with the reason "Wallet execution is the next step"

### Requirement: Demo isolation

The demo source SHALL remain available and labelled Simulated. Fixture data MUST NOT appear under a real account, and choosing the demo MUST switch every port to the simulated implementation together.

#### Scenario: Real account

- **WHEN** a real account is connected
- **THEN** no fixture position, scripted reply or simulated receipt is shown

### Requirement: Read-only capability

This change SHALL NOT sign, send, build transaction payloads in the browser, hold keys, or treat a supplied account id as authentication.

#### Scenario: No wallet call during chat

- **WHEN** a full question, card and refresh flow completes
- **THEN** no wallet signing or transaction request was made
