## Context

`Playground()` mixes presentation (Three.js scene, panels, dialogs, motion), interaction logic and simulated domain state. Examples: `useState` for `connected`, `debt`, `walletBalance`, `walletOutcome` ("success" | "cancel" | "failure" | "partial"), `guardian`, `reserve`, `receipts`; scripted reply text for chat; `setNotice("Connect the mock wallet…")`. The finance numbers already come from `@mrfund/engine` through `demo.ts`, so the numbers are real engine output on fixture inputs, but the inputs and effects are in-component.

The 16 tests in `apps/web/test/playground.test.ts` exercise behavior through the DOM (repay rejection/approval, Guardian validation/over-limit rejection/replay/deactivate/withdraw, stale recovery, voice, mobile keyboard, entrance sequencing). They are the safety net and are not rewritten.

## Decisions

- **Ports by capability, not one big object.** `session`, `position`, `chat`, `execution`, `guardian`. Live changes replace one port at a time; a mixed configuration (live session, simulated position) stays legal and honest because each port reports its own provenance. A single "demo vs live" boolean would hide mixed states.
- **Provenance is data, not CSS.** Every port exposes `provenance`. Existing simulation labels render through `ProvenanceTag`, which rejects simulated provenance with an absent/non-simulation label and omits simulation copy for live ports. The known unlabelled surfaces below remain unchanged in this refactor.
- **State is read through one hook.** `useConsultation(source)` returns a view model (state + intents) using cached `useSyncExternalStore` subscriptions for every stateful port, including the demo. Presentation components receive view-model slices; they never import `demo.ts`.
- **Intents, not setters.** The UI calls `connect()`, `sendMessage()`, `executeCard(id)`, `guardian.pause()`; it never calls `setDebt` or `setReserve`. The demo implements intents by updating its fixture with the same engine calls as today.
- **Chat is an async event stream.** The chat port returns an `AsyncIterable<ChatEvent>` with the same event kinds as `/api/chat` (`progress`, `text`, `card`, `error`, `done`). The demo emits scripted equivalents, so the later live adapter is a drop-in and the UI is written once against the real protocol. The existing two-second thinking and progressive reveal stay in the presentation layer.
- **No behavior change is a testable claim.** Acceptance is: `playground.test.ts` passes unmodified at every commit; a before/after render comparison (production build, same viewport) shows identical text for the welcome, wallet dialog, chat reply, position panel, Guardian panel and activity panel.
- **Where the provider goes.** Only a type and a `demoSource` factory are added here. No React context is mounted at the root; `/play` receives its source from `app/play/page.tsx` so the landing page never imports wallet or network code.

Composition roots clarification [I, parent-approved]: `Playground` accepts an optional `source` and lazily creates one demo source only when no source is supplied, preserving the unchanged no-prop regression entry. The Server Component page selects `<PlayViewport source="demo" />`; its existing client `PlayViewport` creates the selected source and passes the non-serializable port object to `Playground` within the client tree. Both composition roots may import the demo factory. The hook and extracted presentation modules may not import fixture/simulation modules, enforced by the import guard test. No context/provider is added. The fixture helper exports consumed by the protected landing module and existing tests remain intentionally available; numeric display logic lives in neutral `display.ts`.

## Interface sketch (illustrative, finalized in task 2.1)

```ts
type Provenance = "simulated" | "live";
interface Port { readonly provenance: Provenance }
interface SessionPort extends Port { snapshot(); subscribe(l); connect(method?); disconnect(); }
interface PositionPort extends Port { read(signal): Promise<Result<PositionView, PositionError>>; }
interface ChatPort extends Port { send(req, signal): AsyncIterable<ChatEvent>; }
interface ExecutionPort extends Port { execute(cardId, signal): AsyncIterable<ExecutionEvent>; }
interface GuardianPort extends Port { read(signal); control(action, signal): AsyncIterable<ExecutionEvent>; }
```

`PositionView` carries exact decimal strings and engine outputs (health, liquidation price, data age), never floating-point money. Types reuse `@mrfund/shared` (`PositionSnapshot`, `Card`, `CardReceipt`).

Final interface [I, task 2.1]: all stateful ports expose cached `getSnapshot`/`subscribe` for `useSyncExternalStore`; position also exposes `advice(amount)` and demo-state/refresh intents. Session owns identity and available balance; execution owns receipts and the last repayment transition. Execution and Guardian prepare an opaque approval id with display text, never a UI callback; only `execution.execute(id, outcome, signal)` applies it. Guardian owns policy validation, lifecycle, replay and watcher simulation. `ChatEvent` is the existing type from `@mrfund/agent` (including its shared `Card`); receipts retain shared `CardReceipt` plus presentation metadata and a separate local rejected status. `reset` resets the local domain without disconnecting, as before. No live implementation is added.

## Risks and limits

- A refactor of this size can silently change rendering order or focus behavior. Mitigation: one extraction per commit, tests after each, and explicit render comparison at the end. Focus management and the entrance sequencing tests are the likeliest to fail and are checked after every step.
- Moving code inflates diffs past the 50–350 line commit rule. Mitigation: extraction commits are split by component; pure moves are reviewed with `git diff --color-moved`; if a single move cannot be split below 350 lines, the commit message says it is a pure move and the follow-up edit is a separate commit.

Known gap [V, baseline browser captures, 2026-11-10]: chat greeting/recommendation has no visible Simulated label; the desktop Position stats simulation label is CSS-hidden at 360 px, leaving mobile chat unlabelled. This is a pre-existing honesty gap, not evidence that fixture data is live. The parent explicitly prioritized zero visible change for this refactor. Adding visible labels is therefore deferred to `add-live-wallet-session-ui` task 2.1, where the demo entry is labelled; section 5 of tasks.md keeps that deliberate visible change unchecked.
- This change does not verify browser performance or visual fidelity beyond the render comparison; the user keeps visual QA, as in every previous frontend change.
- No guarantee about live data, wallet or chain behavior: nothing live exists yet.

## Permission and honesty

Permission boundary: unchanged. Nothing here signs, sends, reads a network or stores credentials. Invariant S1: every rendered financial value originates from a port with declared provenance; existing provenance-label slots use `ProvenanceTag` and reject a simulated port with absent/non-simulation label text. The known unlabelled chat/mobile surfaces above are an explicit baseline exception, tracked at task 5.1. Does not guarantee that later live ports are correct.

Review correction [V, 2026-11-10]: `progress/tool=propose_card` carries recommendation intent even when the current adjusted draft is invalid; only validated drafts emit a `card`. This preserves the original re-open/adjust recovery surface without inventing an executable payload. The reviewer reproduction first failed its new DOM regression, then all 217 web tests passed with typecheck and Biome.

Mixed-surface correction [V, 2026-11-10]: five additional surface tests exercise live receipt status/time, activity status/time, watcher availability, Guardian state/loan markers and setup labels. Semantic values no longer live inside a replaceable provenance label. Demo-only Guardian replay controls and example-pricing disclosures are not shown for a live Guardian port. This introduces no live adapter and makes no live fee/activation correctness claim; simulated baseline text is unchanged. Web suite: 222 passed; typecheck and Biome passed.

Cancellation ownership correction [V, 2026-11-10]: source-owned connection, refresh and execution delays clear their timer and reject immediately when aborted. Three new tests first observed a retained timer after abort, then passed with no balance/debt change. The shared delay is internal to the demo adapter, not a new public capability. All 225 web tests, workspace typecheck and Biome passed.

Streamed-card ownership correction [I/V, 2026-11-10]: the hook retains the exact protocol `Card` and passes it to both `position.advice(amount, recommendation?)` and `execution.prepareRepay(amount, recommendation?)`. The adapter, not presentation, validates/maps the proposal to review numbers and approval parameters; the demo keeps a weak identity map of its emitted cards and refuses foreign cards rather than silently using a local draft. Editing the amount, clearing/resetting, or replacing a turn clears the selected card. A non-demo stream test first showed the old 100-USDC review instead of the emitted 250-USDC proposal; it now verifies the 250-USDC approval and explicit adjustment back to 125 USDC. A delayed non-demo text/card stream is also discarded after cancellation. No UI code parses transaction payloads or money from model text.
