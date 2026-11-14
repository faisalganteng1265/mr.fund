Scope update [V, owner decision, 2026-11-13]: the `/play` WalletDialog replaces the originally specified `/connect` page because both logins worked when exercised through the dialog. Accessibility moves to polish task 3.7 and DESIGN to owner task 5.2.

## 1. Contract and dependencies

- [x] 1.1 Record user-approved D31 dual-login scope and reconcile PRD/architecture/P4.3; keep D19, public wallet proof and backend authentication separate. Strict OpenSpec validation passed (2026-11-08); no runtime evidence is implied by this specification commit.
- [x] 1.2 Add pinned browser dependencies and public configuration/types. Config tests failed before implementation and all 12 passed afterward (2026-11-08); no silent chain/mainnet-client fallback. Frozen install passed after explicitly denying the reviewed sponsorship-only postinstall and unrequested connector skills. No global build-policy weakening.

## 2. Independent login adapters

- [x] 2.1 Key-resolution regressions failed before implementation and passed afterward; wrong chain, malformed RPC/key, curve/length and exact-address boundaries are covered. Public testnet MPC read completed in 775 ms (2026-11-08), using a synthetic probe subject: real public derivation, not a user login, account creation, funding or signing.
- [x] 2.2 Hosted lifecycle regressions failed before implementation and passed afterward. Official Auth0 memory-cache login/session restoration maps validated `sub`, not email; cancellation/resolution failures remain sanitized. Logout clears the local SDK cache, not global hosted SSO. Typecheck/focused Biome passed (2026-11-08); human hosted-login completion remains separate evidence.
- [x] 2.3 Connector regressions failed before implementation and passed afterward: passive configured-network reads, validated multiple/empty/malformed accounts, provider failures, current-wallet logout and detachable account-change signals. No access-key/plugin request or signer exposure. Web typecheck and focused Biome passed (2026-11-08); controller concurrency and real-wallet completion remain separate tasks.

## 3. Shared account lifecycle

- [x] 3.1 Account-selection/controller tests passed (2026-11-08): hints cannot authenticate, network preferences are isolated, selected accounts belong to the current provider, identity changes clear prior account context, and errors are sanitized. The focused six-file run passed 88 tests with web typecheck and Biome. Deep provider-side concurrency review remains task 3.2, not claimed by generation checks alone.
- [x] 3.2 Two competing-operation regressions failed before correction; all ten session tests passed afterward (2026-11-08). Login/logout are exclusive, interactive sign-in events cannot supersede the final account read, and passive/disposed results cannot revive cleared context. Remote logout failure clears local identity without claiming provider logout.
- [x] 3.3 Browser-only `WalletProvider`/`useWalletSession` wired into the consultation layout with passive restoration. Evidence [V, source inspection, 2026-11-13]: `apps/web/src/app/play/layout.tsx` mounts `apps/web/src/wallet/react.tsx`; it is route-scoped rather than root-scoped, keeping wallet SDKs out of the landing bundle. The wallet UI change records the production bundle check on 2026-11-10.

## 4. Reachable UI and proof

- [x] 4.1 Connection dialog on `/play`, account picker, loading/error/recovery/logout surface; DESIGN is Moved to polish-live-consultation 5.2 (owner). [V, owner decision, 2026-11-13] The WalletDialog replaces the `/connect` page and home-link wording: login works and was exercised through the dialog. [V, owner-reported, 2026-11-13, testnet] Both login methods worked.
- [x] 4.2 Moved to polish-live-consultation 3.7: keyboard, 360 px, visible focus and reduced motion. [V, owner-reported, 2026-11-13, testnet] NEAR Auth email login displayed implicit account `0b9ef00080505625d3444960ab8bb50d75a6fac77e4d98828a7f40c186aa7cde`; NEAR Connect login used `d-mrf-b1ce96af6a.testnet` in Chrome. Connect wallet product [U]; Auth browser [U]. Chat answered in live mode; no transaction was signed.
- [x] 4.3 **Authorized non-UI slice verified (2026-11-08):** 837 tests passed, 3 opt-in checks skipped; workspace typecheck/lint, production web build and strict OpenSpec validation passed. Hosted-boundary review found no blockers; two lifecycle findings were reproduced, fixed in a separate commit and confirmed closed by the reviewer. App routes remained unchanged. Credential/callback/device/UI proof is deferred, not claimed by these checks.
- [x] 4.4 Recorded module interfaces, exact local/public-read evidence, user-directed UI deferral and remaining gates in INTEGRATIONS, ARCHITECTURE, BUILD-PLAN, D31 and README. Human biometric/real-wallet completion, origin approval and mainnet approved client remain prerequisites for frontend integration. No real login, account funding or public money-flow completion is claimed.

## Commit contract

Every commit contains one behavior, its relevant tests/docs and 50–350 added/deleted lines (including generated files). Parent integrates worker changes and commits only verified paths. Dependencies/interfaces precede consumers; no empty scaffolds, temporary artifacts or secrets are committed. No merge/push unless the user authorizes it for this branch.
