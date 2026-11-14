## ADDED Requirements

### Requirement: Signing capability limited to NEAR Connect sessions

The application SHALL expose transaction signing only for a NEAR Connect session, through a narrow signer that calls the connected wallet's `signAndSendTransactions`. NEAR Auth sessions MUST NOT have a signer, and the wallet session state MUST NOT expose a signer.

#### Scenario: Auth session cannot execute

- **WHEN** the connected method is NEAR Auth
- **THEN** the Execute control is disabled with the reason that this account cannot sign yet, and no wallet call is possible

#### Scenario: Connect session can sign

- **WHEN** the connected method is NEAR Connect with fresh data and a verified payload
- **THEN** Execute is enabled

### Requirement: Payload verification before signing

Before requesting a signature the application SHALL verify the card payload with a pure verifier. Every transaction receiver MUST be the card's token contract or a configured fee contract, every action MUST be a function call with an allowlisted method, and deposits MUST match the expected values. Any other action type (key, transfer, deploy, stake) MUST cause refusal.

#### Scenario: Extra action smuggled into the payload

- **WHEN** a payload contains an `AddKey` or native `Transfer` action
- **THEN** verification fails, the wallet is not called, and the user sees that the card was refused

#### Scenario: Amount differs from the card

- **WHEN** the repay amount in the payload differs from the card's displayed amount
- **THEN** verification fails and no signature is requested

#### Scenario: Wrong network

- **WHEN** the card or payload network differs from the session network
- **THEN** Execute is disabled with a network explanation

### Requirement: Payload bound to the card, the user and the network

The verifier SHALL also require that `ft_transfer_call` targets the configured lending contract, fee transfers go to the configured recipient and equal the card's fee lines, the repay amount equals the card number, and the signer is the session account on the session network.

#### Scenario: Fee to another recipient

- **WHEN** a fee transfer targets an account other than the configured recipient
- **THEN** verification fails and no signature is requested

#### Scenario: Signer differs from the session account

- **WHEN** the payload signer is not the connected account
- **THEN** verification fails and the wallet is not called

### Requirement: Informed two-step approval

The application SHALL show the repaid amount and token, each fee with its recipient, the network and the signing account from the verified payload before invoking the wallet. The wallet's own review is a separate step.

#### Scenario: Fees visible before signing

- **WHEN** the user opens the confirmation for a card with a fee
- **THEN** the fee amount and recipient are shown before any wallet prompt

### Requirement: Freshness and single submission

Execute SHALL re-check card freshness and obtain a fresh final-block position read immediately before signing, and SHALL block with a refresh action if the position changed materially since the card. A card MUST NOT be submitted more than once.

#### Scenario: Position changed since the card

- **WHEN** the fresh read shows a different debt or health than the card's inputs
- **THEN** no signature is requested and the user is asked to refresh the card

#### Scenario: Double activation

- **WHEN** Execute is activated twice before the first call settles
- **THEN** the wallet is called once

### Requirement: Outcome by observation

After the wallet returns, the application SHALL build a repay plan from the verified payload and the returned transaction hashes, read the outcome with the existing outcome reader, and derive the receipt with the existing receipt mapping. `confirmed` MUST require verified evidence and a fresh post-state showing a debt decrease, and a thrown wallet error MUST NOT produce `confirmed`.

#### Scenario: Token accepted but no debt decrease

- **WHEN** the transfer was accepted but the fresh post-state shows no debt decrease
- **THEN** the receipt is `partial` and the character does not become pleased

#### Scenario: Later fee failure

- **WHEN** the repay succeeded and the fee transfer failed
- **THEN** the receipt is `partial`, the repay remains shown as applied and the card is not reset to draft

### Requirement: Errors resolved by re-reading the position

If the wallet reports an error before any transaction hash is known, the application MUST re-read the position: unchanged debt returns the card to draft, and changed debt produces a receipt derived from observation.

#### Scenario: Wallet rejection

- **WHEN** the user rejects in the wallet and a re-read shows unchanged debt
- **THEN** balances and debt are unchanged and the card returns to draft with a message that nothing was sent

#### Scenario: Error but debt changed

- **WHEN** the wallet reports an error but the re-read shows reduced debt
- **THEN** the UI shows a receipt derived from observed state and does not claim the transaction was cancelled

### Requirement: Receipts and links only after observation

Receipts, health changes and explorer links SHALL appear only after the outcome reader returned evidence for the transaction. While unresolved the UI SHALL show a pending state with an explicit Check again action and no polling loop.

#### Scenario: Reader cannot resolve yet

- **WHEN** the reader reports an unresolved transaction
- **THEN** the card shows `submitted` and a Check again action, and no explorer link or health change is displayed

### Requirement: Honest limits

The UI MUST NOT claim that repayment guarantees safety or protection, and MUST present observed debt and health changes as observed deltas rather than causal attribution. The change SHALL NOT add Guardian calls, access-key requests, mainnet transactions or server-side signing.

#### Scenario: Confirmed receipt wording

- **WHEN** a confirmed receipt is displayed
- **THEN** it states observed values and their data time and contains none of the banned phrases
