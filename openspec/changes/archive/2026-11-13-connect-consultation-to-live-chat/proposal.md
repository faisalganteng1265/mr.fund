## Why

`/play` chat is scripted: replies come from fixtures in `Playground.tsx`, and the position, recommendation and what-if numbers come from `demo.ts` fixtures even though they pass through the real `@mrfund/engine`. The tool-driven chat API (`POST /api/chat`, SSE events `progress`/`text`/`card`/`error`/`done`, merged in PR #4) and the read-only position API (`add-position-read-api`) exist or are specified, but no screen consumes them. Until the consultation talks to them, the product's central promise (an assistant that explains your real position with numbers only deterministic code produced) is not visible, and BUILD-PLAN P4.4 ("no fixture data shown as live") cannot be met for a real account.

## What Changes

- Add a **live `chat` port** to the consultation source: a client for `POST /api/chat` that parses the SSE stream into the protocol-shaped events already defined by `refactor-consultation-data-source`, supports cancellation, and maps HTTP and stream failures to stable, recoverable UI states.
- Add a **live `position` port** that reads `POST /api/position` for the active session account, refuses to display data when `networkId` differs from the wallet network, and shows data age.
- Render recommendation **cards** from `card` events (`propose_card`) instead of fixtures. Execute stays **disabled with a stated reason** until `add-wallet-manual-repay-execution` ships; this change signs and sends nothing.
- Keep the demo source intact and labelled. A connected real account never shows fixture numbers.
- Surface server error states honestly: rate limited, assistant unavailable (no provider key), context unavailable, stale data, no position.
- Chat answers, history window and locale follow the handler's contract (message ≤ 4000 characters, history ≤ 20 messages and 16 000 characters total, locales `en|id|es`).
- No change to the chat handler, engine, tools or numeric guard.

## Capabilities

### New Capabilities

- `live-consultation`: The consultation UI consumes the live chat stream and live position, with provenance, data age, recoverable failures and non-executing cards.

### Modified Capabilities

None.

## Impact

`apps/web/src/play/source/` (live ports and SSE client), `apps/web/src/play/` (surface wiring), `apps/web/test/`, `docs/DESIGN.md`, BUILD-PLAN P4.4. Depends on `refactor-consultation-data-source` (ports), `add-live-wallet-session-ui` (session account) and `add-position-read-api` (position route).

Gates: local work needs none (fake fetch and recorded SSE). A live smoke needs server env (`NEAR_NETWORK_ID`, `NEAR_RPC_URL`, `RHEA_LENDING_ID`, fee variables and `NEARAI_API_KEY`/`NEARAI_MODEL`) in `apps/web/.env.local`, and an account that has a position on the configured network. D19 (network), D25 (GLM acceptance: 34/36 answers, 22/36 approved by independent review, still open) and B7 are not decided here; the change works on whichever network is configured and records which one it observed. This change does not claim GLM answer quality. The `accountId` in a chat request is not authentication (the route says so); the UI therefore treats everything it shows as public on-chain data.
