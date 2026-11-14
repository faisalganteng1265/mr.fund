## Context

The controller API is fixed [V, `wallet/session.ts`]: `getSnapshot`, `subscribe`, `restore`, `login(method)`, `selectAccount`, `logout`, `dispose`. `WalletState.status` is one of `checking | disconnected | connecting | connected | signing-out | error`; `session` carries `method`, `network`, `accountId`, `accounts`, `contextKey`. Provider state is authority; `localStorage` holds only a network-scoped hint. Public configuration comes from `NEXT_PUBLIC_NEAR_NETWORK_ID`, `NEXT_PUBLIC_NEAR_RPC_URL` and `NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID` via `wallet/config.ts`, which has a documented shared testnet client and refuses a mainnet client fallback.

## Decisions

- **Provider scope: the `/play` route, not the root layout.** `add-dual-near-auth` task 3.3 said "root layout". The landing page never needs a wallet, and NEAR Connect and Auth0 SDKs are heavy and browser-only. Mounting in `app/play/layout.tsx` keeps them out of the landing bundle. This deliberately narrows task 3.3's wording; tasks.md records the reconciliation.
- **Adapters are constructed lazily and only in the browser.** SSR renders the `checking` state. A construction failure (bad config, SDK load failure) becomes `error` with a recovery action, never a thrown render error.
- **React binding is `useSyncExternalStore` over the controller.** No parallel React state copy exists, so the stale-result protections already proven in `wallet-session*.test.ts` stay the single source of truth. The binding adds no new async logic.
- **Passive restore never prompts.** On mount the provider calls `restore()`. The welcome screen shows a neutral "Checking your wallet" state, not the connect dialog, so a returning user is not flashed a login prompt.
- **Demo stays, explicitly.** The simulated wallet moves behind a labelled "Try the simulated demo" action that selects the demo source's `session` port. Rationale: judges without a wallet, CLAUDE.md's required fake wallet for Playwright, and a safe offline path. It is never the automatic fallback of a failed real login: failure shows the error and recovery, and the user chooses demo themselves.
- **Honest capability copy.** The UI derives a capability line from `method`: Auth = "read and chat only; signing is not available for this account yet", Connect = "read and chat; wallet signing is requested only when you approve an action". The copy is data-derived from `method`, not model text.
- **Network display.** A badge shows `session.network` and the configured network. If the connector returns accounts for a different network, the controller already rejects them; the UI shows that rejection as a recoverable error, not an empty state.
- **Account picker only when needed.** One account → no picker. Several → a listbox with the current account marked; selecting calls `selectAccount`. Hints never authenticate (existing invariant).
- **Logout states.** `signing-out` disables other actions. A remote logout failure already clears local identity without claiming provider logout; the UI says so in those words (no "fully signed out" claim).
- **Accessibility.** The dialog traps focus, restores it to the opener, closes on Escape unless `connecting`, announces status changes through a polite live region, and every state works at 360 px. Motion respects `prefers-reduced-motion`.

## Permission and honesty

Permission boundary: this change adds no signer, no transaction request, no access-key or plugin request, no server authentication and no stored credentials beyond the existing hint. A NEAR Connect login only reads account ids. Invariants:

- W1: the UI never displays an account that is not in `session.accounts` for the active `method` and `network`.
- W2: no simulated data is shown under a real account id without the simulation label (inherited from the consultation-source spec).
- W3: UI text never claims signing, funding, protection or full provider logout beyond what the controller reported.

Negative tests (fake adapters, no network): login failure shows error and keeps demo reachable but unselected; cancel returns to disconnected without error styling beyond a neutral notice; wrong-network accounts rejected; empty account list; logout failure; double click during `connecting`; unmount during login does not update state; missing configuration blocks real login.

It does not guarantee: that a real hosted login or wallet works in a given browser (needs human proof, task 4.3), that a derived Auth address has funds or a Rhea registration, or that any Connect wallet will later sign a transaction.

## Risks

- Hosted login needs the app origin and callback allowed by the Auth provider. Local `http://localhost:3000` works only if the shared testnet client allows it [U]; a failure here is an external-gate finding, not a code defect. Recorded as evidence, never mocked as success.
- Auth0 and NEAR Connect third-party scripts can change behavior. Mitigation: pinned dependencies (already pinned in `add-dual-near-auth`) and visible error states.
- Large diff risk in `Playground.tsx`. Mitigation: depends on `refactor-consultation-data-source`; this change only swaps the `session` port and its dialog.
