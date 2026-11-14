## ADDED Requirements

### Requirement: Unsigned activation payload builders

The client SHALL build unsigned activation payloads against the verified final factory and Guardian ABI: the factory creation call with funding inside `[min_funding, max_funding]` and at least 145 Tgas, `owner_register` calls with exactly 1 yocto, and the reserve plus activation-fee deposit as a debt-token `ft_transfer_call` with the `activate` message. Builders MUST be pure, MUST NOT import a signer, and MUST refuse stale snapshots, non-owner contexts and out-of-range values.

#### Scenario: Funding below the minimum

- **WHEN** the requested funding is below the factory's `min_funding`
- **THEN** the builder refuses and no payload is produced

#### Scenario: Altered model prose

- **WHEN** a card's explanatory text is altered
- **THEN** the payload bytes and every number are unchanged

### Requirement: Policy form validated by the contract's rules

The activation form SHALL collect the PRD F6 fields and block review until each is valid under the same rules the contract enforces: trigger at least 105%, cooldown at least 5 minutes, max per action greater than zero and at most reserve minus floor, max total at least max per action, reserve deposit at least max per action plus one action fee plus floor with the activation fee on top, and target above trigger when provided.

#### Scenario: Trigger below the contract minimum

- **WHEN** the trigger is 104.99%
- **THEN** review is blocked with a message naming the 105% minimum

#### Scenario: Valid form

- **WHEN** every field is valid
- **THEN** the review summary is available

### Requirement: Summary equals payload

The plain-language summary SHALL be generated from the policy struct that will be sent, and every number in it MUST equal the corresponding number in the payload. Fees and their recipient MUST be shown before signing and MUST be read from the factory or Guardian template rather than hard-coded.

#### Scenario: Summary number drift

- **WHEN** a summary number differs from the payload number
- **THEN** verification fails and signing is not offered

#### Scenario: Fee shown from chain

- **WHEN** the template activation fee is 0
- **THEN** the review shows a zero fee with its recipient and no fee is invented

### Requirement: Step-wise activation observed from chain

Activation SHALL proceed as separate wallet steps (creation, registration, reserve deposit), each verified before signing and observed after. Progress MUST derive from on-chain state, and reloading mid-activation MUST resume at the first incomplete step. A Guardian MUST be shown as created only after a `created` factory result or `guardian_created` evidence.

#### Scenario: Reload after creation

- **WHEN** the page is reloaded after creation but before registration
- **THEN** the UI shows the Guardian as created and not active and offers the registration step

#### Scenario: Transaction hash only

- **WHEN** only a transaction hash is known and the creation result is unresolved
- **THEN** the UI shows creation pending and does not show a Guardian

#### Scenario: Creation failed with claimable refund

- **WHEN** the factory reports `failed` with `refund: claimable`
- **THEN** the UI shows the failure phase and the amount and offers `claim_refund`

### Requirement: Verified, owner-only signing

All Guardian creation, registration, funding and owner-control payloads SHALL pass payload verification before the wallet is called: receivers limited to the configured factory, the user's own Guardian, the configured debt token and lending contract, allowlisted methods, expected deposits and gas floors, and no key, stake, deploy or native transfer actions beyond the creation batch built by the factory contract. Signing MUST be available only for NEAR Connect sessions.

#### Scenario: Extra key action

- **WHEN** a payload contains an `AddKey` action
- **THEN** verification fails and the wallet is not called

#### Scenario: Auth session

- **WHEN** the session is NEAR Auth
- **THEN** the form is viewable, signing is disabled and the reason is stated

### Requirement: Guardian panel from validated reads

The panel SHALL show status, policy limits, reserve and spendable amount, history, and watcher heartbeat age from block-pinned validated reads. Missing evidence (transaction links, hashes, heartbeat) MUST be shown as unavailable, retained-ring truncation MUST be stated, and an offline heartbeat MUST show its exact age.

#### Scenario: History truncated

- **WHEN** the contract history ring has dropped older entries
- **THEN** the panel states that older attempts are not retained

#### Scenario: Unknown in-flight operation

- **WHEN** the Guardian reports an in-flight lock without an operation kind
- **THEN** the panel shows locked with outcome unknown and offers no control that implies it can be cleared

### Requirement: Owner controls with correct availability

Pause, Resume, Deactivate and Withdraw SHALL each be a verified card signed in the wallet, available only in states where the contract allows them. A deactivated Guardian MUST disable automation controls but keep withdrawal available, and withdrawal MUST be blocked while an operation is in flight.

#### Scenario: Deactivated Guardian

- **WHEN** the Guardian is deactivated
- **THEN** Pause and Resume are unavailable and Withdraw remains available

#### Scenario: Withdraw during in-flight

- **WHEN** a repay is in flight
- **THEN** Withdraw is unavailable with the reason

### Requirement: Honest limits and labelled simulation

The UI MUST NOT claim that a Guardian prevents liquidation, that it can recover its NEAR, or that heartbeat proves the watcher will act, and MUST use only approved wording ("reduces liquidation risk within limits you set"). The simulated Guardian MUST remain available only as the labelled demo.

#### Scenario: Banned wording

- **WHEN** any Guardian copy is rendered
- **THEN** it contains none of the banned phrases

### Requirement: Guardian-held loan steps are verified before the wallet

Per the user decision of 2026-11-11 (task 5.1), an activated Guardian's panel SHALL offer collateral deposit, `owner_borrow` and `owner_sweep`, each only while nothing is in flight. Each payload MUST be exactly the `guardianPositionPayload` output for its intent and MUST pass `verifyGuardianPayload` before any wallet prompt.

#### Scenario: Collateral deposit

- **WHEN** the owner deposits collateral
- **THEN** the only call is the configured collateral token's `ft_transfer_call` to the own Guardian with `{"collateral":{}}`, the chosen amount, 1 yocto and at least 180 Tgas

#### Scenario: Borrow and sweep

- **WHEN** the owner borrows or sweeps
- **THEN** the only call is own-Guardian `owner_borrow({amount})` with at least 260 Tgas, or `owner_sweep({token_id})` for the configured debt or collateral token, each with 1 yocto

#### Scenario: Tampered loan payload

- **WHEN** a loan payload targets another token, receiver, message, Guardian or sweep token, attaches other than 1 yocto, carries too little gas or an amount other than the one chosen
- **THEN** it is refused before any wallet prompt

### Requirement: Guardian-held loan outcomes come from chain reads

Holdings SHALL come only from final-block views, with collateral rounded down and debt rounded up from Rhea internal units. A step's outcome SHALL be the comparison of the reads before and after it; transaction hashes SHALL appear only after a change is observed.

#### Scenario: Wallet error without a change

- **WHEN** the wallet throws and the next read shows the targeted value unchanged
- **THEN** the panel states that nothing changed on chain as of the read time, never that the step succeeded

#### Scenario: Unreadable holdings

- **WHEN** the Rhea account or a token balance cannot be read or validated
- **THEN** the loan section says it could not be read and offers no loan step
