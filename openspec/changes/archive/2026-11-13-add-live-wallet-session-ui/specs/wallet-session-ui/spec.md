## ADDED Requirements

### Requirement: Browser-only wallet provider scoped to the consultation route

The application SHALL mount a client-only wallet provider for the `/play` route and expose the wallet controller state through a React hook. The landing route MUST NOT import wallet SDKs. Server rendering MUST produce the `checking` state without touching browser-only APIs.

#### Scenario: Landing bundle stays wallet-free

- **WHEN** the production build is analyzed
- **THEN** the landing route does not include the NEAR Connect or Auth SDK modules

#### Scenario: Server render is safe

- **WHEN** `/play` is rendered on the server
- **THEN** it renders the checking state and does not throw

### Requirement: Real login choices with an explicit demo entry

The connect surface SHALL offer NEAR Auth and NEAR Connect as login methods and a separate, labelled "Try the simulated demo" entry. A failed or cancelled real login MUST NOT switch to the demo automatically.

#### Scenario: Login cancelled

- **WHEN** the user cancels a login
- **THEN** the state returns to disconnected with a neutral notice and the user is not connected to anything, including the demo

#### Scenario: Demo chosen explicitly

- **WHEN** the user selects the simulated demo
- **THEN** the consultation runs on the demo source and every surface carries the simulation label

### Requirement: Passive restoration without prompts

On load the application SHALL attempt provider-side restoration without opening any login prompt, and MUST show a neutral checking state rather than the connect dialog while restoration is pending.

#### Scenario: Returning user

- **WHEN** a provider reports an existing session during restoration
- **THEN** the consultation opens connected as that account without an interactive prompt

#### Scenario: No existing session

- **WHEN** restoration finds no session
- **THEN** the disconnected welcome screen appears and no popup, redirect or dialog opens on its own

### Requirement: Account and network display

The UI SHALL display the active account id, the login method, and the active network badge, and MUST display only accounts present in the current provider session for the current network. When several accounts exist it SHALL offer a picker that selects only among them.

#### Scenario: Multiple accounts

- **WHEN** the provider returns two accounts
- **THEN** the picker lists exactly those two, marks the active one, and selecting another updates the displayed account

#### Scenario: Account from another network

- **WHEN** a provider returns an account for a different network than configured
- **THEN** the UI shows a recoverable error that names the configured network and shows no account

### Requirement: Honest capability statement

The UI SHALL state what the connected account can do, derived from the login method: a NEAR Auth account is read-only for transactions; a NEAR Connect account signs only when the user later approves a specific action in their wallet. The UI MUST NOT claim signing, funding, protection or complete provider logout beyond what the controller reported.

#### Scenario: Auth account

- **WHEN** the connected method is NEAR Auth
- **THEN** the UI shows that signing is not available for this account and does not render an enabled sign action

#### Scenario: Remote logout failure

- **WHEN** provider logout fails but local identity is cleared
- **THEN** the UI states that this device is signed out and that the provider session may remain, and does not say "fully signed out"

### Requirement: Recoverable states for every controller status

Each controller status (`checking`, `disconnected`, `connecting`, `connected`, `signing-out`, `error`) SHALL have a reachable, visible state with a recovery path. While `connecting` or `signing-out`, conflicting actions MUST be disabled and repeated activation MUST NOT start a second operation.

#### Scenario: Double activation

- **WHEN** the user activates a login method twice quickly
- **THEN** only one provider operation starts

#### Scenario: Unmount during login

- **WHEN** the consultation unmounts while a login is pending
- **THEN** later provider results do not update state or open prompts

### Requirement: Explicit configuration errors

When public wallet configuration is missing or inconsistent, the UI SHALL show a configuration error and block real login. It MUST NOT fall back to another network or to a client id for a different network.

#### Scenario: Mainnet without an approved client

- **WHEN** the configured network is mainnet and no Auth client id is set
- **THEN** NEAR Auth is unavailable with an explanation, and NEAR Connect remains selectable if its configuration is valid

### Requirement: Accessible and responsive surfaces

The connect dialog, account picker and status surfaces SHALL be keyboard operable with visible focus, trap and restore focus, announce status changes to assistive technology, fit a 360 px viewport, and respect reduced motion.

#### Scenario: Keyboard-only login path

- **WHEN** a user operates only the keyboard
- **THEN** they can open the dialog, choose a method, select an account, close with Escape (except while connecting), and return focus to the opener

### Requirement: No new signing or credential capability

This change SHALL NOT request transactions, access keys or plugins, create or fund accounts, authenticate against a server, or persist anything beyond the existing network-scoped hint.

#### Scenario: Login requests no signing capability

- **WHEN** a login completes
- **THEN** no transaction or access-key request was made to the wallet
