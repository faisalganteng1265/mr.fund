## Context

Three workers implement this change in parallel on separate branches off `dev`. The design fixes the shared contracts and file ownership so their branches merge without conflicts.

## File ownership

| Worker | Branch | Owns (may edit) | Must not edit |
|---|---|---|---|
| A: chat backend | `fix/live-chat-latency` | `apps/web/src/server/**`, `packages/agent/**`, `apps/web/src/play/source/liveChat*.ts`, `apps/web/src/play/useLiveConsultation.ts`, chat/position docs, `docs/PRD.md` data-age wording | any `.tsx` file |
| B: voice | `feat/live-voice` | `apps/web/src/play/VoicePanel.tsx`, new `apps/web/src/play/speech/**`, `apps/web/src/play/useConsultation.ts` (speech extraction only), `Playground.tsx` **only** the `CharacterPortrait` `speaking`/`speech` props and one hook call | `LivePanels.tsx`, server, agent |
| C: live UI | `feat/live-chat-ui` | `apps/web/src/play/LivePanels.tsx`, new `apps/web/src/play/live/**`, `ChatMessages.tsx`, `ReplyText.tsx`, `ConsultationHeader.tsx`, `Playground.tsx` **only** the header props block and the `LiveChatPanel` props, `ProvenanceTag.tsx`, styles | server, agent, `VoicePanel.tsx`, `speech/**`, `useLiveConsultation.ts` |

Tests go in `apps/web/test/` or the package's `test/` with names that match the owned module. Shared test helpers are not edited; copy what you need.

## Contracts between workers

1. **`useLiveConsultation` return value** (owner A). Existing fields keep their meaning. A adds `slow: boolean`, true while `busy` has lasted at least 15 000 ms, false otherwise. C renders it; B does not read it.
2. **Assistant message text** (owner A). `live.messages[i].content` for `role: "assistant"` is plain text using only this subset: paragraphs separated by a blank line, `**bold**`, unordered list lines starting `- `, ordered list lines starting `1. `. No headings, links, tables, code, HTML or em/en dashes. A enforces dashes deterministically in the agent output path; the rest is persona instruction. C renders the subset and shows anything else as literal text.
3. **Markdown stripping for speech** (owner B). B ships `stripReplyMarkup(text): string` in `speech/` that removes `**` and list markers so speech never reads symbols. C may import it for accessible labels; C does not re-implement it.
4. **Reply speech** (owner B). `speech/` exposes a hook used by both demo and live: given the latest final assistant message `{ id, text, lang }` and the `sound` flag, it speaks each id once, cancels on a new turn, clear, unmount or sound off, and returns `{ speaking: boolean, cue }` where `cue` has the shape `CharacterPortrait` already accepts. Live language: the locale sent with the request when known, otherwise `id-ID` when the reply is Indonesian by the existing heuristic, else `en-US`.
5. **Data age** (owners A and C). The model no longer states data age unless a tool reported stale or missing data. C shows a "Updated N s ago" label from the live position's `dataAgeMs` plus elapsed time since the read, and on each card from `card.dataAgeMs`. PRD rule 2 is satisfied by the label.

## Decisions

- **Deadline 60 000 ms, measured first.** A records per-stage timings (context reads, each provider call, repair round, total) server-side without message content, then picks reductions by the numbers. Candidate reductions: parallel context reads, a faster configured RPC URL, avoiding a second provider round when tool facts already answer. Token streaming to the browser is rejected: the numeric guard must see the full reply before display.
- **Fund-manager voice.** Conclusion first, then at most four short bullets, plain words, one suggested next step. No hype, no banned phrases, no jokes about losses. Same rules in every language.
- **Voice input state machine.** A pure, timer-injected state machine (`idle → starting → listening → stopping → idle`, plus `error`) drives the browser recognizer with `continuous = true`, `interimResults = true`. A browser `end` event while the user still wants to listen restarts the recognizer and keeps the transcript. Silence = no result event for 60 000 ms → stop with a notice. Hard cap 300 000 ms per session. `not-allowed`, `service-not-allowed` and `audio-capture` stop without restart. More than 3 consecutive restarts within 2 000 ms each with no new result stops with "Voice input stopped" to avoid a restart loop. Language cannot change while listening. Sending is always manual.
- **Safe rendering.** C builds React elements from the subset; no `dangerouslySetInnerHTML`, no new dependency.

## Risks

- Browser speech engines differ; Chrome may end continuous sessions roughly every minute even while speaking. The restart rule covers this; tests use a fake recognizer, and the owner checks a real browser.
- A 60 s deadline alone does not fix slow turns; the measured reductions are what matter. If the measured provider time alone exceeds 60 s on common questions, A records it and the owner decides on the model (D25).
- Persona changes can lower eval scores. A reruns the eval and reports the result as observed.
