Gate summary: all local work (sections 1–3) uses fake `fetch` and recorded SSE and needs no external gate, no accounts and no keys. Section 4 live smoke needs server env in `apps/web/.env.local`, a model key and an account with a position on the configured network (D19 undecided; the change records whichever network it observes). D25 GLM acceptance and its quality verdict are separate and untouched. Depends on `refactor-consultation-data-source` (ports, tasks 2.1–2.4), `add-live-wallet-session-ui` (task 1.2) and `add-position-read-api` (route available locally with fake RPC).

## 1. Clients

- [x] 1.1 Implement the SSE framing parser and chat client with abort support and the failure taxonomy. Tests: split UTF-8 and frame boundaries, unknown event, malformed JSON, missing `done`, 400/429/5xx/network, abort mid-stream and after `done`.
  - Local evidence: `pnpm exec vitest run apps/web/test/live-chat.test.ts apps/web/test/live-chat-request.test.ts` passed 12 tests; `pnpm typecheck` passed. UI integration remains separate.
- [x] 1.2 Implement request building with the history and message bounds and locale rule. Tests at each exact limit (20 messages, 4 000 characters each, 16 000 total) and one over.
  - Local evidence: `pnpm exec vitest run apps/web/test/live-chat-request.test.ts` passed 4 tests; `pnpm typecheck` passed.
- [x] 1.3 Implement the live `position` port over `/api/position` with `networkId` match, data age and explicit refresh. Tests: mismatch, stale, no position, RPC unavailable, abort, no polling.
  - Local evidence: live position tests cover explicit reads, wrong account/network, stale/empty/unavailable states, cancellation and superseded responses. The design records why this live store carries the API view rather than the demo snapshot interface.
- [x] 1.4 Add the pure atomic-unit formatter and use it for every money value shown. Tests: zero, 6- and 24-decimal values, very large bigint, no floating arithmetic (property test against a bigint reference).
  - Local evidence: exact formatter tests cover 0–24 decimals and large bigint round trips; live position displays server atomic amounts with their token decimals. Fees without supplied token precision are explicitly labelled atomic units.

## 2. Surface wiring

- [x] 2.1 Wire the live chat port to the chat panel: progress and thinking tied to real events, partial text discarded if interrupted, message preserved on failure, no automatic retry. Demo mode unchanged.
  - Local evidence: live panel tests cover streamed answer, interruption/input recovery, and replacement of a pending turn; existing playground suite passes.
- [x] 2.2 Render `card` events with server values; Execute disabled with the stated reason; stale data disables actions and shows Refresh. Test that no success, pending or receipt appears.
  - Local evidence: live panel test observes the server card with disabled Execute and no receipt state; position store test verifies expiry without a network poll.
- [x] 2.3 Position surface for a real account: data age, network-mismatch and empty states; chat disabled on mismatch. Demo isolation test: a real account never shows fixtures; switching to demo switches all ports.
  - Local evidence: live panel tests cover account switching, network mismatch and empty/stale states; `live-playground.test.ts` mounts the existing room with a fake live session and checks that demo position values are absent. No actual wallet was used.
- [x] 2.4 Accessibility and responsive pass for new states (live regions for streaming status, focus after errors, 360 px, reduced motion).
  - Local evidence: live integration tests cover status/alert regions, focus restoration, keyboard submission and a 360 px reduced-motion media-query state. Before the user's request to stop browser automation, a temporary fake-session preview showed the live chat at 360×800 and a response after Enter; this was not a real-wallet or visual-polish acceptance. The temporary preview was removed.

## 3. Documentation

- [x] 3.1 Record the live ports and error mapping in `docs/DESIGN.md`; note the Execute-disabled interim state. Do not tick P4.4 yet.

## 4. Evidence (observed only)

- [x] 4.1 Local smoke with the real route and a fake RPC/provider: ask, card, error and cancel behavior in `next dev`; record observed results.
  - Local evidence, 2026-11-10: `next dev` on localhost:3104, with synthetic credentials and a temporary fetch interceptor serving recorded RPC and fake provider responses, returned position HTTP 200; chat `hello` produced text and `done`, `card` produced a tool-built unsigned repay card and `done`, `error` produced sanitized `unavailable`, and a cancelled HTTP request caused the fake provider to observe abort. The interceptor was removed; this was not a public network or wallet run. `live-handler-integration.test.ts` additionally exercises the clients against those handler boundaries, including cancellation.
- [x] 4.2 **Live smoke (lead provides env and account):** with `apps/web/.env.local` set, a connected account that has a position, one real question and one position refresh; record network, account id, model id, data age shown, latency and any failure verbatim. Mark as exercised only what ran. If no public account with a position exists on the configured network, record that as the blocker [U].
  - Evidence [V, 2026-11-13]: root-local env was injected into real `next dev --port 3111`; public testnet `juaner116.testnet`, model `z-ai/glm-5.3-flash`. Position GET/POST/refresh succeeded with exact-block engine parity (ages 3637/4098/3114 ms; latency 6027/4398/3368 ms). Real chat HTTP 200 ended in `timeout` after 60622 ms; no guarded model answer was delivered. Detailed blocks/hashes/stages are in CHAT-API "Public testnet HTTP read smoke".
  - [U, owner: lead]: successful connected-wallet UI consultation/data-age display remains unexercised by this HTTP-only worker; the provider exceeded the 60 s budget. Root env availability is established, not a passing connected-surface smoke. Superseded by the 2026-11-13 owner-reported run below.
  - Evidence [V, owner-reported, 2026-11-13]: the owner logged in through NEAR Connect (Meteor) as `my-dev.testnet` on testnet (Rhea `0.11.0`, fixed `default_price` inputs, health 43200 bps from `GET /api/position` at block 277533637, data age 2273 ms) after opening a position with their own signing (collateral 0.5 wNEAR, debt 0.2 REF), and reported that the connected account showed in the header and chat worked. Model id `anthropic/claude-haiku-5-5` (server env). Fixes needed on the way: wallet chooser inside the modal dialog and repeated Meteor accounts (`9aae530`).
  - [U]: UI data-age display, chat latency and the exact question asked were not recorded by the owner; no screenshot or transaction links are attached here. Nothing was signed by the app itself.
- [x] 4.3 Run `pnpm test`, `pnpm typecheck`, `pnpm lint` and the production build; record counts.
  - Local evidence, 2026-11-10: final `pnpm test` 1112 passed, 3 skipped; `pnpm typecheck`, `pnpm lint` (277 files) and `pnpm --filter @mrfund/web build` passed; strict OpenSpec validation passed.
- [x] 4.4 Update BUILD-PLAN P4.4 progress with the observed evidence only; the P4.4 box stays open until execution and receipts are wired.

## Commit contract

Every commit contains one behavior, its tests and relevant docs, and 50–350 added/deleted lines. Interfaces and pure modules (parser, formatter, request builder) precede the surfaces that use them. No secrets, captured live responses with account data, or temporary files are committed. Commit identity and no-push/no-merge rules follow the repository instructions.
