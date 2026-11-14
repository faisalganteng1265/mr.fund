## 1. Offline provider orchestration

- [x] 1.1 Define provider adapter and turn event contracts using trusted server ToolContext; align with awaitable dispatcher from add-guardian-client-and-tools.
- [x] 1.2 Add fake-provider tests for tool ids, six-call total including parallel calls, shared deadline (originally 30 seconds; now 60 seconds under `polish-live-consultation` 1.2), malformed args, cancellation and provider failure.
- [x] 1.3 Implement bounded tool loop and current-tool source-number collection; reject forged client tool facts and exclude payload bytes from provider tool messages.
- [x] 1.4 Buffer final prose, enforce number/persona guards, regenerate at most once then deterministic fallback; prove no invalid chunk is emitted.

## 2. Server Route Handler

- [x] 2.1 Create backend-only apps/web/src/app/api/chat/route.ts with bounded request/history/body validation and server-only provider configuration.
- [x] 2.2 Implement per-IP/account bounded in-memory rate buckets with explicit proxy-header trust, disconnect propagation and sanitized streaming/error/done events.
- [x] 2.3 Test spoofed forwarded IP, limit exhaustion, oversized history, provider secret errors and log redaction; document account id is public-read context rather than authentication.

## 3. Multilingual evaluation

- [x] 3.1 Author 12 distinct prompts in three languages (36 cases) with expected facts, language review criteria, injections, refusal and card-bound checks.
- [x] 3.2 Implement offline/live eval runners with recorded model/settings/date/latency and separate results; full Guardian cases require real validated tools or explicit simulated fixtures.
- [ ] 3.3 Historical 2026-11-08 evidence: B6 access configured, GLM protocol/catalog probe and four full live runs recorded; the last had 34/36 model outputs and two guarded comparison fallbacks. Independent assistant review (not human/provider review): 36/36 correct language, 22 content/honesty approvals and 14 rejections. Isolated repeats are not acceptance.
  - Latest [V, 2026-11-13]: full 36-case live rerun on the same **Simulated** fixture/settings produced **20 model answers / 16 timeouts**, 36/36 numeric/claim checks, **20/36 content**, **35/36 card**, **33/36 language heuristic** passes; **36 independent reviews pending**, `modelAccepted: false`. Mean/max **50858.671/60025.881 ms**. Initial 20-minute harness timeout was recorded, then the 40-minute harness completed without changing turn deadlines or gates. Leave 3.3/D25/P3.4 open; owner: lead. Scenario matrix and evidence paths: CHAT-API "Live multilingual rerun (2026-11-13)".
  - Haiku 5.5 [V, 2026-11-13]: two full runs; raising `max_tokens` 1024 → 2048 cut mid-sentence answers from 8 to 1. At 2048: 34/36 model answers, 0 timeouts, 9 semantic failures (2 guard fallbacks, 1 cut-off, 6 rubric mismatches on correct wording), reviews pending, `modelAccepted: false`. Still open: model choice (owner), rubric review (lead), the two fallbacks and 36 independent reviews. CHAT-API "Haiku 5.5 runs and the token limit".
  - Acceptance attempt [V, 2026-11-13]: default model set to Haiku 5.5 by the user; fallbacks fixed (guard names the refused word; persona lists localized guarantee words), `max_tokens` 3072, rubric widened with paired refusals and locked. Final run 08:13:47 passed every automated gate; independent assistant review: language 34/36, content 30/36, forbidden claims 33/36 → `modelAccepted: false`. Box stays open for: the small-integer threshold gap in the number guard, the data-age conflict between eval criteria and persona, and a run that passes review. CHAT-API "Haiku 5.5 acceptance attempt".
  - Follow-up [V, 2026-11-13]: the threshold is now a sourced engine fact, the guard refuses unsourced comparison thresholds, the persona answers data age when asked and states the repay direction. Runs 08:31 and 08:35: 36/36 model answers each, numbers/claims/cards/language passing, automated content 35/36 and 33/36, all misses being correct wording. Rubric tuning stopped; the box stays open pending the lead's decision on whether a recorded independent review may override rubric misses (CHAT-API "Follow-up").

## 4. Validation and docs

- [x] 4.1 Final local verification (2026-11-08): 744 tests passed, 3 skipped; build, typecheck, lint and strict OpenSpec validation passed. Production HTTP public-read smoke completed; direct-runtime leading-decimal rejection and saved-review application were also exercised. Provider credentials stay server-only; this backend adds no signer or durable transcript store. These checks do not close the model-acceptance gate.
- [x] 4.2 Document event protocol, per-process rate-limit/privacy boundaries, P3.4/P3.5 evidence, four full-run outcomes, completed assistant-review findings and exact-decimal observed-cost estimates. P3.5 is backend implementation only; D25/P3.4/3.3 stay open pending complete passing live evidence and independent review, not fallbacks or a diagnostic subset. No human review or deployment readiness is claimed.
