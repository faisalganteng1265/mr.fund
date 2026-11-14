## Why

The owner's end-to-end pass on 2026-11-13 (testnet, NEAR Auth and NEAR Connect sessions, no transactions) found that the live consultation is clearly worse than the labelled demo:

1. Live chat fails after 30 seconds. `apps/web/src/server/chat/handler.ts` aborts the whole turn (context reads, every provider round and any repair round) at 30 000 ms, and two diagnostic turns hit that limit.
2. The live chat is unstyled. `LivePanels.tsx` renders plain `<p>` text: no Mr.Fund avatar, no demo bubble styling, no suggestion prompts, and model markdown shows as raw `**` with bullets collapsed into one paragraph.
3. Replies read stiffly, use em dashes and open with "data is fresh (age ~13 s)", because `persona.ts` asks the model to state data age on every answer.
4. Live replies are silent. Demo speech lives inside `useConsultation.ts`; `useLiveConsultation.ts` has none, and the avatar never speaks in live mode.
5. Voice input stops at the first pause because `VoicePanel.tsx` uses `continuous = false`.

The feature freeze has passed (2026-11-12 23:59). These are fixes to shipped surfaces, not new features.

## What Changes

- Turn deadline becomes 60 000 ms; the UI shows a "still thinking" state after 15 s; latency is measured per stage and reduced where the data shows it. The numeric guard still sees the full reply before anything is shown.
- Persona moves to a concise fund-manager voice with a small markdown subset (paragraphs, `**bold**`, lists), no em or en dashes, and no data-age sentence unless data is stale. Data age moves to a UI label, so every on-screen number still shows its age (PRD rule 2 unchanged).
- Live chat adopts the demo chat visuals, renders the markdown subset safely, offers state-aware suggestions and shows Simulated labels where the demo is shown.
- Reply speech becomes a shared module used by demo and live; the avatar speaks in live mode under the existing speaker toggle.
- Voice input becomes tap-to-start, tap-to-stop, survives pauses, stops itself after 60 s of silence or a 5-minute cap, and never auto-sends.
- Remaining accessibility items of `add-live-wallet-session-ui` 2.5, `add-dual-near-auth` 4.2, `add-wallet-manual-repay-execution` 3.3 and `refactor-consultation-data-source` 5.1 move here so those changes can close.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-consultation`: deadline, slow state, reply formatting, suggestions, data-age label, reply speech and toggle voice input.

## Impact

`apps/web/src/server/chat/`, `packages/agent/src/{persona,chat,chat-output}.ts`, `apps/web/src/play/{LivePanels,VoicePanel,Playground,ConsultationHeader}.tsx`, `apps/web/src/play/{useConsultation,useLiveConsultation}.ts`, new `apps/web/src/play/speech/` and `apps/web/src/play/live/`, `apps/web/test/`, the owning chat API doc under `docs/technical/`, `docs/PRD.md` data-age wording.

No money path changes: no builder, verifier, signer, contract or watcher file is touched. External gates: none for local work. Live latency measurement uses public read-only RPC and the configured NEAR AI key; no account creation, funding or transaction. D25 (model acceptance) stays open unless its own eval acceptance is met.
