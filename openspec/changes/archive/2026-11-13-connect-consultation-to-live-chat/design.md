## Context

The server contract is fixed [V, `apps/web/src/server/chat/handler.ts`]: `POST /api/chat` with `{ message, accountId, locale?, history?, guardianId? }`; unknown keys, empty or over-4000-character messages, invalid account ids, more than 20 history items, items over 4000 characters or 16 000 total characters are rejected; per-account and per-IP rate limiting answers `429 rate_limited`; the route comment states `accountId` "is not wallet authentication". Responses stream SSE events `progress`, `text`, `card`, `error`, `done`. A reply containing a number no tool returned is rejected server-side (BUILD-PLAN P3.2); the browser must not undermine that by computing or editing numbers.

## Decisions

- **Live position is a separate view model.** The existing demo `PositionPort` requires an engine `PositionSnapshot` and computes demo advice, while `/api/position` returns a presented wire view without that snapshot. Live consultation consumes the wire view directly through a separate live position store and renders the returned asset arrays within the existing consultation layout; it must not synthesize a snapshot or reuse demo advice, asset names, values, Guardian state, or receipts. The demo retains its existing port and layout. The live composition owns its chat history and account-scoped lifetime, so changing account or network aborts reads and clears prior results.
- **The UI renders, never computes.** Every number shown comes from a `card` payload, a position response or a tool-derived structure. The client does not parse numbers out of `text` events, does not recompute health, and does not reformat money from floats; bigint/decimal strings are displayed with a pure formatter that is unit-tested at boundaries (zero, 6-decimal USDC, 24-decimal NEAR, very large values).
- **Own the SSE parser, keep it small.** Use `fetch` with `ReadableStream` and a ~60-line framing parser (event/data lines, UTF-8 chunk boundaries) instead of `EventSource`, which cannot POST. Unknown event kinds are ignored; malformed JSON in a known event ends the turn as an `error` event. No dependency is added.
- **Cancellation is first-class.** Each turn owns an `AbortController`; sending a new message, clearing the chat, or unmounting aborts it. After abort no event updates the transcript. Partial text is shown only while streaming and is discarded if the stream ends without `done`, so the UI never presents an unfinished reply as an answer.
- **Failure taxonomy maps to copy and recovery.** HTTP 400 → "I could not read that question" (retry editing); 429 → rate-limit notice with retry later; 5xx/network → assistant unavailable with Retry; `error` event → its safe message; stream closed without `done` → interrupted. No raw server text, stack, or prompt content is displayed. Each state keeps the user's message in the input for resend.
- **History is sent from the transcript, bounded client-side.** The client keeps the last 20 messages within 16 000 characters (dropping oldest first) so a long conversation never turns into a 400. Card and progress events are not sent as history.
- **Live position gates the live chat.** Chat is enabled for a real account only after the position port reports a state (position, no position, or an explicit unavailable). The first-message prompt is the user's own; no model call happens on load.
- **Network match is a hard display rule.** The position response carries `networkId`. If it differs from `session.network`, the position surface shows a network-mismatch error and the chat is disabled. A response never silently replaces the other network's data.
- **Data age is always visible.** Position and cards show data age; stale (per the engine's freshness rule, returned by the server) disables card actions and shows a refresh action. Refresh calls the position port again; there are no hidden retries or polling.
- **Cards are non-executing here.** A `card` event renders title, reason, numbers, fees and the unsigned-action summary. Execute is disabled with the stated reason "Wallet execution is the next step" so there is no dead or fake success button. `add-wallet-manual-repay-execution` enables it.
- **Provenance per surface.** Chat and position ports report `live` only when the real client is active. Mixed mode (live session, demo position) cannot occur because choosing demo switches all ports together; this keeps the label rule simple. The consultation-source spec still supports mixed ports for later changes.
- **Locale.** Pass the UI locale when it is one of `en|id|es`; otherwise omit it.

## Permission and honesty

Permission boundary: read-only. The client sends public account ids and user text to the app's own `/api/chat` and `/api/position`; it holds no key, signs nothing, and builds no transaction. Invariants:

- L1: no number is displayed that the server's tools or engine did not return.
- L2: a response for another network is never displayed as the wallet's network.
- L3: cancelled or interrupted replies never appear as completed answers.
- L4: demo fixtures never appear under a real account.

Negative tests (fake `fetch` and recorded SSE fixtures): split UTF-8 and split frame boundaries; unknown event; malformed JSON; no `done`; 400/429/500/network failure; abort during stream and after `done`; mismatched `networkId`; stale position; no position; history truncation at both limits; text containing a number is displayed verbatim and never used to compute anything; card with Execute disabled; simultaneous sends.

It does not guarantee: answer quality (D25 acceptance is separate), that the model never produces a banned phrase (server guard owns that), that data is fresh beyond the age shown, or that a `card` is executable.

## Risks

- Dependence on a model key and provider availability: handled as visible "assistant unavailable"; the app remains usable with positions and cards-less state.
- The route's per-IP limiting is weak by default (`direct-client` without proxy configuration); not changed here, noted for deployment (D29/P6).
- Streaming UI motion can hide delay. The existing progressive reveal and thinking states are tied to real events (`progress`, `text`), not timers, in live mode.
