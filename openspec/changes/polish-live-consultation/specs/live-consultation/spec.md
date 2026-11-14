## ADDED Requirements

### Requirement: Chat turn deadline and slow state

A live chat turn SHALL be aborted by the server after 60 000 ms and reported with the existing `timeout` error code. The consultation SHALL show a "still thinking" state once a turn has been busy for 15 000 ms and MUST keep cancellation available throughout.

#### Scenario: Turn finishes just before the deadline

- **WHEN** the provider answers at 59 900 ms
- **THEN** the reply is delivered normally

#### Scenario: Turn reaches the deadline

- **WHEN** the turn is still running at 60 000 ms
- **THEN** the server aborts provider and context work and the client shows the timeout state with Retry

#### Scenario: Slow but healthy turn

- **WHEN** a turn has been busy for 15 000 ms
- **THEN** the client shows the still-thinking state, and sending a new message or Stop still cancels the turn

### Requirement: Reply formatting and voice

Assistant replies SHALL lead with the conclusion, use at most the markdown subset defined in design.md, and MUST NOT contain em or en dashes. Replies MUST NOT state data age unless a tool reported stale or missing data. The client SHALL render the subset as formatted text without injecting HTML and show any other markup literally.

#### Scenario: Bold and list in a reply

- **WHEN** a reply contains `**Debt:** none` and three lines starting with `- `
- **THEN** the UI shows bold text and a three-item list, with no visible asterisks

#### Scenario: Markup injection attempt

- **WHEN** a reply contains `<img src=x onerror=alert(1)>`
- **THEN** the UI shows it as literal text and no element is created

#### Scenario: Dash normalization

- **WHEN** the model output contains an em or en dash
- **THEN** the delivered text contains none, and every number the guard accepted is unchanged

### Requirement: Data age label

Every live position view and live card SHALL show its data age as a visible label derived from the read time, so numbers carry their age without the model stating it.

#### Scenario: Fresh position

- **WHEN** a position was read 13 seconds ago
- **THEN** the label reads "Updated 13 s ago" (or the localized equivalent) and the reply text does not mention data age

### Requirement: Live suggestions

The live chat SHALL offer suggestion prompts that match the current live state (no position, position ready, stale, unavailable). Suggestions MUST be hidden while a turn is busy and MUST send through the same path as typed messages.

#### Scenario: Account without a position

- **WHEN** the connected account has no lending position
- **THEN** suggestions explain concepts and Guardian rather than offering a repay

### Requirement: Live reply speech

When the speaker toggle is on, each final live assistant reply SHALL be spoken once, without reading markup symbols, and the avatar SHALL show speaking state during playback. Speech MUST stop on a new turn, clear, sound off or leaving the screen.

#### Scenario: New question during speech

- **WHEN** the user sends a question while a reply is being spoken
- **THEN** speech stops immediately and the new reply is spoken when it arrives

### Requirement: Toggle voice input

Voice input SHALL start on one tap and stop on the next. Pauses MUST NOT end the session or clear the transcript. The session SHALL stop itself after 60 000 ms without recognized speech or 300 000 ms in total, and on permission or device errors without retrying. A transcript MUST never be sent without the user's explicit send.

#### Scenario: Short pause

- **WHEN** the user pauses for 5 seconds and the browser ends its recognition session
- **THEN** recognition restarts, the earlier transcript is kept, and the mic stays on

#### Scenario: One minute of silence

- **WHEN** no speech is recognized for 60 000 ms
- **THEN** the mic stops, a notice says why, and the transcript stays editable and unsent

#### Scenario: Permission denied

- **WHEN** the browser reports `not-allowed`
- **THEN** the mic stops, the permission message is shown and no restart is attempted

#### Scenario: Restart loop

- **WHEN** the recognizer ends more than 3 times in a row within 2 000 ms each with no new result
- **THEN** the mic stops with a "Voice input stopped" notice
