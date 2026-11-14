## Why

The `add-dual-near-auth` modules (`apps/web/src/wallet/`: `createWalletSession`, the NEAR Auth and NEAR Connect adapters) are implemented and tested, but nothing imports them. `/play` still opens a mock wallet dialog ("Connect the mock wallet", "Disconnect mock wallet" in `Playground.tsx`), so a visitor cannot sign in, pick an account, see which network they are on, or recover from a failed login. `add-dual-near-auth` tasks 3.3 (React wiring), 4.1 (connection screen) and 4.2 (browser and human-login proof) are still open and BUILD-PLAN P4.3a stays unchecked. The user deferred this UI on 2026-11-08; this change records the approved scope for when UI work resumes.

This is the first change that lets a real account into the consultation. It must stay honest about what a login proves: a NEAR Auth address is derived and read-only (no signing path exists), and a NEAR Connect account can be read but this change does not ask it to sign anything.

## What Changes

- Mount a browser-only `WalletProvider` and `useWalletSession` for the `/play` route (not the landing page), feeding the `session` port defined in `refactor-consultation-data-source`.
- Replace the mock wallet dialog with real choices: **NEAR Auth** (social/passkey) and **NEAR Connect** (ecosystem wallets), plus an explicit, labelled **Try the simulated demo** entry. The simulated wallet is kept (CLAUDE.md requires a labelled fake wallet for Playwright and demos); it is no longer the default path.
- Show the connected account, method, and network badge; an account picker when the provider returns several accounts; passive restore on load without prompting; logout; and visible loading, error and recovery states for every `WalletState.status` (`checking`, `disconnected`, `connecting`, `connected`, `signing-out`, `error`).
- Explain read-only status in plain language: an Auth account says it can read and chat but cannot sign yet.
- Missing or inconsistent public configuration shows a configuration error. There is no silent fallback to another network or to the shared testnet client on mainnet.
- Keyboard, focus, 360 px and reduced-motion behavior for the new surfaces.
- Update `docs/DESIGN.md` and BUILD-PLAN P4.3a; close `add-dual-near-auth` tasks 3.3, 4.1 and 4.2 only with observed evidence.

## Capabilities

### New Capabilities

- `wallet-session-ui`: Browser login, account selection, network display, restore and logout surfaces over the existing wallet controller.

### Modified Capabilities

None. The login behavior itself (`dual-near-auth`) is unchanged; this change consumes it.

## Impact

`apps/web/src/app/play/` (layout), `apps/web/src/wallet/` (a React binding only; adapters and controller untouched), `apps/web/src/play/` (dialog and session surfaces), `apps/web/test/`, `docs/DESIGN.md`, BUILD-PLAN P4.3a, `add-dual-near-auth` tasks. Depends on `refactor-consultation-data-source` tasks 2.1, 2.2 and 3.1.

External gates: none for local work. Real-login proof needs a human with a passkey or wallet account on the configured network (D19 open; testnet is the documented default per D31). A mainnet NEAR Auth client id still needs NEAR's per-domain approval and is not required for testnet. No account creation, funding, signing or server authentication is introduced; B7 testnet accounts are not required for the local work.
