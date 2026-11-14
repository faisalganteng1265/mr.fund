## Why

The user approved dual login on 2026-11-08: NEAR Auth for hosted social/passkey onboarding and NEAR Connect for ecosystem wallets. P4.3 currently has receipt parsing but no browser connection. These choices must produce network-qualified account context without granting the chat model signing authority.

## What Changes

- Add a browser-only login module with NEAR Auth and NEAR Connect adapters, passive restoration, explicit account selection and logout.
- Defer the shared React context and `/connect` surface: the user explicitly stopped all UI-related work on 2026-11-08. Deliver adapters and the framework-independent account controller only; the existing app UI stays unchanged.
- Derive the NEAR Auth Ed25519 implicit address from the authenticated identity using the deployed MPC public-key view; distinguish an address from a funded/created account.
- Configure network/RPC explicitly; require an approved client id for mainnet Auth. No email/password/passkey material or private key enters Mr.Fund.
- Commit independently verified units of 50–350 added/deleted lines, including tests/docs/lockfile changes, as requested by the user.

## Capabilities

### New Capabilities

- `dual-near-auth`: Two browser login paths with one explicit active account and unchanged on-chain permissions.

### Modified Capabilities

None. The public-read chat endpoint remains unauthenticated; a browser session is not a server authorization token.

## Impact

`apps/web/src/wallet/`, pinned browser dependencies, public environment documentation and P4.3 evidence. No React/root wiring or screen changes in the current authorized slice. No Rust changes, account creation/funding, arbitrary transfers, transaction submission, local signing keys, backend sessions, account linking or durable chat storage. Frontend integration and manual/public money-flow evidence remain separate P4.3/P4.5 work.
