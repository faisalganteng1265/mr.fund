# dual-near-auth Specification

## Purpose

Define independent NEAR Auth and NEAR Connect login and account isolation without spending authority.

## Requirements

### Requirement: Explicit dual login

The browser SHALL offer NEAR Auth and NEAR Connect independently on the explicitly configured NEAR network. Missing/invalid network or RPC configuration MUST disable connection with recovery guidance. Missing mainnet Auth credentials MUST disable only NEAR Auth, never silently use shared development credentials.

#### Scenario: Auth deployment not configured

- **WHEN** mainnet network/RPC are configured without an approved Auth client id
- **THEN** ecosystem wallet connection remains available and Auth explains the missing prerequisite

### Requirement: Authentic identity to account mapping

NEAR Auth SHALL use the official Auth0 browser SDK against the network-specific NEAR Auth tenant and the published identity derivation path. It SHALL obtain an Ed25519 public key from the deployed MPC contract and decode exactly 32 key bytes to its implicit account address. It MUST NOT invent a named account, create/fund an account, or equate email/provider display names with account ownership.

#### Scenario: New authenticated identity

- **WHEN** the hosted provider authenticates an identity and the MPC public-key read succeeds
- **THEN** the browser exposes its network-qualified implicit address and states that login does not prove account funding or create an on-chain account

#### Scenario: Invalid derived key

- **WHEN** the RPC returns a malformed, wrong-curve or wrong-length key or the wrong network
- **THEN** the browser exposes no connected account and gives a retryable sanitized error

### Requirement: Honest hosted login capabilities

Hosted login methods, including passkeys, SHALL depend on tenant/device support. Fingerprint availability MUST NOT be promised or implemented by collecting biometric material in Mr.Fund.

#### Scenario: Passkeys unavailable

- **WHEN** the tenant or device does not offer passkeys
- **THEN** the interface describes hosted sign-in rather than claiming fingerprint login is available

### Requirement: Account isolation and session lifecycle

The module SHALL expose one active method, network and account selected from validated adapter accounts. Stored method/account hints MUST NOT authenticate anyone. Restoring a session MUST check the selected provider without prompting, signing, creating a key or broadcasting. Logout and provider/account changes MUST invalidate stale asynchronous results.

#### Scenario: Logout races with login

- **WHEN** logout occurs while a provider login or restore is outstanding
- **THEN** the late result cannot repopulate connected state

#### Scenario: Multiple wallet accounts

- **WHEN** a wallet supplies several validated accounts
- **THEN** users can select among those accounts; an unrelated account id cannot be injected and no email-based linking occurs

### Requirement: Account selection is not linking

Selecting an unavailable account MUST fail without changing the session. Account-specific consumers SHALL use method/network/account identity, not a human name or email.

#### Scenario: Unrelated account injection

- **WHEN** a caller selects an account absent from the current provider's set
- **THEN** the selection fails and the previously selected account remains unchanged

### Requirement: Complete accessible connection surface

The connection dialog on `/play` SHALL show checking, disconnected, connecting, connected, signing-out, configuration/error states and recovery. It SHALL expose both login choices, network, full account address, supported account selection and explicit sign-out. It MUST support keyboard focus, 360 px width and reduced motion. Existing frontend screens MUST NOT be redesigned. [V, owner decision, 2026-11-13] The exercised WalletDialog replaces the originally specified `/connect` page.

#### Scenario: Cancelled or failed login

- **WHEN** the user cancels or the hosted provider/wallet fails
- **THEN** no fabricated session appears, raw SDK/token errors are not rendered, and the user can retry or choose the other login path

### Requirement: Login is not spending authority

Neither adapter nor the shared context SHALL import user private keys, install function-call/session keys, sign messages/transactions, create accounts or submit funds. The chat endpoint remains public-read only; no browser-supplied account id becomes server authentication. Guardian I1–I10 and wallet approvals remain unchanged. Approval count, gas sponsorship, yield execution and existing wallet-to-Auth account migration MUST NOT be promised.

#### Scenario: Login completes

- **WHEN** either login path succeeds
- **THEN** only account context changes; no transaction, approval, receipt or Guardian permission is implied
