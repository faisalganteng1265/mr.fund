Gate summary: no external gate. No D19, B7, D24, credentials or network access is needed. Commit contract: one extraction per commit, 50–350 changed lines (pure moves are labelled as such and reviewed with `git diff --color-moved`); every commit passes `pnpm lint`, `pnpm typecheck` and the playground tests.

## 1. Baseline

- [x] 1.1 Record the current baseline: `pnpm test` summary, `pnpm --filter @mrfund/web build`, and rendered text of the welcome, wallet dialog, chat reply, position, Guardian and activity panels captured from `next dev` at one desktop and one 360 px viewport. Store captures only in ignored `scratch/`.
  Evidence [V, 2026-11-10]: `pnpm test`: 67 files passed, 3 skipped; 936 tests passed, 3 skipped. Production build passed. Managed Chromium captures at 1440×900 and 360×800: `scratch/consultation-baseline.json`.
- [x] 1.2 List behaviors in `Playground.tsx` that no existing test covers (receipt detail, partial wallet batch, Guardian replay, data-state switch in Demo settings, voice sample). Add characterization tests for each before moving code; they must pass on the unmodified file.
  Evidence [V, 2026-11-10]: `pnpm exec vitest run apps/web/test/consultation-characterization.test.ts apps/web/test/playground.test.ts`: 25 passed on unchanged production code; eight additions cover failed/partial receipts and unchanged funds, confirmed receipt metadata/health, repeated-replay cooldown, loading/empty/error recovery, editable voice approval. Basic replay, stale switch and voice sample were already covered. `pnpm typecheck` and `pnpm lint` passed (202 files).

## 2. Ports and demo source

- [x] 2.1 Define `ConsultationSource`, port types and `ChatEvent`/`ExecutionEvent` in `apps/web/src/play/source/types.ts`, reusing `@mrfund/shared` types; unit-test the type-level contract with a minimal fake.
  Evidence [V, 2026-11-10]: web typecheck first failed on missing source types, then `pnpm typecheck` passed; `pnpm exec vitest run apps/web/test`: 194 passed; `pnpm lint`: 204 files clean. Final interface recorded in design.md.
- [x] 2.2 Implement `ProvenanceTag` for existing labels; test simulated-with-label, live-without-label and mixed configurations, plus the negative case (simulated label absent/invalid fails). Known unlabelled surfaces remain section 5.
  Evidence [V, 2026-11-10]: provenance tests first failed on the missing component; all 199 web tests now pass, workspace typecheck and Biome (206 files) pass. Parent explicitly preserved visible copy and deferred missing chat/mobile labels.
- [x] 2.3 Extract the position/engine fixture logic to the demo source `position` port (no UI change).
  Evidence [V, 2026-11-10]: position tests first failed on the missing adapter; `pnpm exec vitest run apps/web/test`: 201 passed, including original health, repayment, cached subscription and stale advice checks. Workspace typecheck and Biome (208 files) pass. UI cutover follows at 3.1.
- [x] 2.4 Extract scripted chat into the demo `chat` port as an `AsyncIterable<ChatEvent>`; keep the two-second thinking and progressive reveal in the UI; test abort leaves no stale event.
  Evidence [V, 2026-11-10]: stream tests first failed on the missing adapter; `pnpm exec vitest run apps/web/test`: 204 passed, including protocol events and cancellation before/mid-stream. Workspace typecheck and Biome (210 files) pass. UI timing is unchanged pending 3.1 cutover.
- [x] 2.5 Extract mock wallet connection and the four outcomes into the demo `session` and `execution` ports; test cancel/failure/partial/success keep or change balances exactly as before.
  Evidence [V, 2026-11-10]: execution tests first failed on missing adapters; `pnpm exec vitest run apps/web/test`: 209 passed, including all four outcomes, connection progress and cancellation before settlement. Workspace typecheck and Biome (213 files) pass. UI cutover follows at 3.1.
- [x] 2.6 Extract simulated Guardian lifecycle, over-limit rejection, replay, reserve and receipts into the demo `guardian` port.
  Evidence [V, 2026-11-10]: Guardian tests first failed on missing composition; all 211 web tests passed, including separate debts, unchanged rejected reserve, cooldown, offline/paused blocking and owner withdrawal. Focused Guardian tests (2), workspace typecheck and Biome (216 files) passed after retaining the original bigint reduction form. UI cutover follows at 3.1.

## 3. Hook and component split

- [x] 3.1 Add `useConsultation(source)` and move state and intents into it; `Playground` renders from the view model only.
  Evidence [V, 2026-11-10]: hook contract first failed typecheck before injection existed. After cutover `pnpm exec vitest run apps/web/test`: 214 passed, including unchanged interaction tests, eight baseline characterizations, abort/replacement hook tests and fixture-import guard; workspace typecheck and Biome (220 files) passed. Parent approved one atomic state-cutover commit-size exception and the composition-root default.
- [x] 3.2 Extract `WalletDialog`, `ChatPanel`, `PositionPanel`, `GuardianPanel`, `ActivityPanel` and `ReceiptDetail` one per commit; no style or copy change.
  Evidence [V, 2026-11-10]: each named module landed in its own checked commit; larger chat/Guardian sections were first split into cohesive smaller presentation modules to keep commits below 350 changed lines. `pnpm exec vitest run apps/web/test`: 216 passed after the final named extraction; workspace typecheck and Biome (231 files) passed. Existing test files remain untouched.
- [x] 3.3 Mount `demoSource` from `app/play/page.tsx`; verify the landing route's bundle does not include `play/source/`.
  Evidence [V, 2026-11-10]: page selects serializable `source="demo"` and existing client PlayViewport creates the source (parent-approved App Router clarification). All 216 web tests, typecheck, Biome (237 files) and production build passed. Landing client-reference manifest lists only landing/framework modules; its three referenced chunks and server dependency trace contain no `play/source`, demo-source module names or execution markers (targeted grep: no matches).

## 4. Verification

- [x] 4.1 Run the unmodified `playground.test.ts` plus new tests, full `pnpm test`, `pnpm typecheck`, `pnpm lint` and production build; compare against the task 1.1 baseline (same text and numbers in every panel).
  Evidence [V, 2026-11-10]: final reviewed `pnpm test`: 79 files/979 tests passed, 3 files/tests skipped (baseline 67/936 passed, 3 skipped). `pnpm typecheck`, `pnpm lint` (240 files), `pnpm --filter @mrfund/web build` passed. All 12 key-panel text comparisons at 1440×900 and 360×800 are byte-identical; mobile chat was observed at its baseline's `Le` reveal phase with the same complete accessible reply/card. Evidence: ignored `scratch/consultation-{baseline,after,comparison}.json`.
- [x] 4.2 Run `next dev`, exercise welcome → connect → ask → repay → Guardian activation → over-limit rejection → deactivate; record the observed result. Browser visual QA stays with the user.
  Evidence [V, 2026-11-10]: managed Chromium against port 3102 completed the local flow. Debt changed 1,800→1,700 USDC, health 158.33→167.64%; activation reserve 500 USDC remained 500 after over-limit rejection, then Guardian showed Deactivated with withdrawal still available. Evidence: ignored `scratch/consultation-smoke.json`. No chain/wallet execution or visual-polish judgment is claimed.
- [x] 4.3 Update BUILD-PLAN P4.4 (progress note only, no checkbox) and `docs/DESIGN.md` (module map); no feature or evidence claim beyond what ran.
  Evidence [V, 2026-11-10]: added the observed local evidence note under unchecked P4.4 and the implemented module/ownership map in DESIGN.md. Feature checkboxes remain unchanged; task 5.1 remains unchecked by parent decision.

## 5. Known honesty gap (deliberate visible change)

- [x] 5.1 Moved to polish-live-consultation 3.6: visible Simulated labels on chat and 360 px surfaces. This move does not claim the labels are implemented.
