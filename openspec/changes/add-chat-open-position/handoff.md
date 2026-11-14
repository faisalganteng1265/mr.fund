# add-chat-open-position: hand-off (2026-11-13)

Labels: [V] verified with a command or recording, [I] design or inference, [U] unknown. Everything
below is **tested locally**; nothing has been run in a browser or a real wallet by this change.

## What exists

A chat user with a wallet and a configured opening pair can ask Mr.Fund how much they could
borrow, get a draft **deposit** card, approve and sign it in their own wallet, and afterwards get a
separate **borrow** card quoted from the collateral Rhea now holds. Each card is reviewed in an
in-app confirmation before the wallet opens, and every outcome shown afterwards comes from chain
receipts plus a fresh position read.

## Changed files (by layer)

| Layer | Files |
| --- | --- |
| Engine (numbers) | `packages/engine/src/open-position.ts`, `test/open-position.test.ts`, `test/fixtures/rhea-borrow-vectors.json` |
| Rhea reads and payloads | `packages/rhea/src/open-position-context.ts`, `src/tx/open-position.ts`, `test/open-position-context.test.ts`, `test/open-position-payload.test.ts` |
| Rhea outcomes | `packages/rhea/src/outcome-core.ts`, `open-position-outcome.ts`, `open-position-reconcile.ts`, `outcome-rpc.ts`, their tests, `fixtures/rhea/opening-outcomes.json` |
| Verifier and signer | `apps/web/src/execution/open-position-verify.ts`, `signer.ts`, `test/open-position-verify.test.ts` |
| Runner and store | `apps/web/src/execution/open-position-run.ts`, `open-position-live.ts`, `useLiveOpening.ts`, `config.ts`, `test/open-position-run*.ts`, `test/open-position-live.test.ts` |
| UI | `apps/web/src/play/OpeningExecution.tsx`, `LivePanels.tsx`, `Playground.tsx`, `test/opening-execution-ui.test.ts` and the four existing panel tests (they now pass an idle opening) |
| Agent tools | `packages/agent/src/opening-tools.ts`, `tool-support.ts`, `tools.ts`, `dispatch.ts`, `index.ts`, `test/opening-tools.test.ts` |
| Server | `apps/web/src/server/chat/context.ts`, `test/chat-context.test.ts`, `.env.example` |
| Docs | `docs/PRD.md`, `docs/technical/ARCHITECTURE.md`, `INTEGRATIONS.md`, `CHAT-API.md`, `docs/LESSONS.md`, `docs/OPEN-DECISIONS.md`, this change's `tasks.md` |

## Checks that ran [V, local]

- `pnpm test`: 148 files passed, 3 skipped, 1961 tests passed (2026-11-13, after the UI commit).
- `pnpm typecheck` and `npx biome check apps packages`: clean.
- Every guard has a mutation exercise (break the guard, watch a test fail); equivalent mutants are
  named in `tasks.md` and `INTEGRATIONS.md`.
- Real evidence: five recorded testnet transactions (Rhea 0.11.0, fixed default prices) drive the
  outcome, reconcile and runner tests; two real borrow vectors pin the share arithmetic.

## Permission boundary

- The LLM can only call `quote_opening` and `propose_opening`. Their arguments are `stage`,
  `amount`, the stage's own `token` and `target_health_percent`; every other value comes from the
  server context. The payload never reaches the model's tool message.
- Only a NEAR Connect session has a signer. The signer accepts only what `verifyOpeningPayload`
  issued for that account and network. NEAR Auth sessions see "cannot sign".
- A card is single-use: once the wallet is asked it never unlocks. "Check again" only reads.
- Nobody handles a private key.

## Invariants and negative evidence

| Id | Evidence |
| --- | --- |
| OP-1 | `open-position-verify.test.ts` (66 tests, forged, smuggled and changed-target cases), signer tests |
| OP-2 | verifier tests on amounts, scale, exact-withdraw and pre-existing supplied balance; runner preflight test |
| OP-3 | `open-position.test.ts` and `opening-tools.test.ts`: maximum and maximum + 1, stale or missing price, invented numbers rejected by `checkNumbers` |
| OP-4 | `open-position-run.test.ts` (two concurrent executes, one wallet request) and `open-position-live.test.ts` (second prepare after submit is refused, one card cannot sign another) |
| OP-5 | `open-position-reconcile.test.ts`, outcome parser tests with real recordings (root success with a failed receipt, debt without delivery, refund) |

Does not guarantee: a faithful wallet display, exact token delivery, atomicity between the deposit
and the later borrow, or that the position is unchanged between the last read and inclusion.

## Assumptions [I]

- The numbers are estimates from one block-pinned read; the card says so and the runner re-matches
  within 0.1 % debt and 0.5 points of health before signing.
- Testnet prices are Rhea's fixed `default_price`; USDC has no testnet oracle price, so the pair
  tested is wNEAR collateral and REF debt.
- A borrow is available when a fresh read shows collateral in Rhea, not only right after this
  session's deposit.

## Remaining risks and owners

| Item | Owner | Missing prerequisite |
| --- | --- | --- |
| 1.1, 1.3 pair and per-stage fee decision, fee policy | founder / lead | decision; until then `propose_opening` answers `fee_policy_missing` |
| 1.2, 1.4 imported-bytecode and gas tests | lead | slow sandbox run (about 15 minutes each) and approval |
| 5.3, 5.4 browser and Playwright scenarios | lead or whoever may run a browser | agent rule: no browser checks; the dev server is run by the user |
| 6.1, 6.2 one real-wallet deposit and borrow | lead | explicit human authorization and a funded testnet wallet |
| Chat-model acceptance (3.3 of the chat API change, D25) | lead | decision on the answer-quality gate |
| Fresh mainnet prices, Guardian gates | unchanged | out of scope here |

Public acceptance stays **unchecked**. No mock success was inserted.
