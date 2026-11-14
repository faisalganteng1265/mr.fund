# Mr.Fund: open decisions and blockers

## TL;DR

- **Decided by the founder on 2026-11-04:** D1 to D15 and D17 (verbatim table below), plus D20 to D23: 0xlann submits and owns `github.com/0xlann/mr.fund`; project skills are committed; `main` plus a `dev` branch; `docs/DESIGN.md` waits for frontend work.
- **Decided 2026-11-05:** D16 tech stack, Option A (Next.js + Rust Guardian + Node watcher).
- **Custody and network selected:** user selected D18 **G1 Guardian-held loan** on 2026-11-07 and testnet for the hackathon on 2026-11-11. Full testnet lending and Guardian acceptance still require observed evidence.
- **The finding that changed the plan:** Rhea lending has **no repay-on-behalf** in its published source, so a Guardian cannot automatically repay a loan that lives in the user's wallet (D18, B1). Rhea's testnet lending contract exists, but its stablecoin price feeds returned `null` (D19, B2).
- **Work that can proceed before those decisions:** the deterministic finance engine and Rhea read adapter are TypeScript under every viable stack option (BUILD-PLAN P1.1 to P1.5), and Phase 0 probes are read-only or testnet-only.

Founder-owned rows are never silently decided by agents. Lead-owned rows record reasoning so the founder can overrule. Status values: Decided, Lead proposal, Open, Blocked. Each row has its explanation below.

## Decided (founder, 2026-11-04)

Copied verbatim from the founder's decision table. "Decided" means the founder said it; "Lead proposal" means the orchestrator recommended it and the founder did not object, so the lead may refine it with a reason.

| # | Topic | Decision | Status |
| --- | --- | --- | --- |
| D1 | Name | **Mr.Fund** (formerly DAYLIGHT). Name and domain availability unchecked [U] | Decided |
| D2 | Product type | A **real DeFi app with a game-like character**, not a simulation game. Like Talking Tom, but a hedge-fund-manager character who manages your DeFi | Decided |
| D3 | Character | Witty, frank, on the user's side. Not rude by default. Never jokes in a way that hides risk or shames the user. One well-made personality for the hackathon | Decided |
| D4 | Game extras | **No evolving room and no missions in the core.** They may return later as optional extras | Decided |
| D5 | Input | **Typing is first-class**; many users are not fluent in English, so text chat must work well in the user's own language. Voice (Talking Tom style speech) is an additional layer, never required | Decided |
| D6 | Core jobs | (a) **Debt manager**: explain the position, compare repay versus yield, repay. (b) **Guardian**: protect a lending position. (c) **Investment assistant**: recommend where spare funds could go and route them to Rhea or other supported DeFi. (d) **Execute** the chosen action | Decided |
| D7 | Guardian activation | **Opt-in "Activate Guardian"**, with an **extra fee**. Setup is an **interactive form** (position, allowed action, max amount, reserve to keep, trigger threshold, fee shown before activation), and the user can **ask the Guardian questions in chat** about its rules, status and past actions | Decided |
| D8 | Keys | The agent can repay, but the user **never hands over a private key**. Manual actions are signed by the user's wallet. Automatic Guardian actions go through a contract or scoped permission that enforces the limits; the agent can only request actions the policy allows | Decided |
| D9 | What-if | No separate what-if feature. Users **ask Mr.Fund directly** ("what if ETH drops 20%?") and get the answer in chat, computed by deterministic code | Decided |
| D10 | Recommendation card | Every recommendation renders as an **interface card** (action, reason, numbers and assumptions, fees, risks) with **Adjust** and **Execute now** buttons. After execution it becomes the receipt (status, transaction link, result) | Decided |
| D11 | Yield vault | The user says how much to transfer into a yield option; Mr.Fund **monitors and guards** that placement afterwards. Automatic exit from a vault is a separate, riskier permission and needs its own proof | Decided (exit automation: lead proposal, P1) |
| D12 | Fees | Fees on all paid services (Guardian, executed actions, managed placements), always disclosed before approval with recipient and amount. Exact pricing open | Decided (pricing open) |
| D13 | Cross-chain | **Future development.** NEAR Intents may be used, including a custom testnet endpoint if one is proven to work. Not in MVP, never claimed in the demo unless executed | Decided |
| D14 | Education | No academy, courses or quizzes. Education is embedded: short in-context explanations, "Why this?" on every card, assumptions visible | Lead proposal |
| D15 | Tracks | Unstoppable DeFi primary. Agent Economy only if the agent really spends or earns in an economic loop (for example paying for a service it needs). AI Security only if the contract-enforced limits are demonstrated. Never claim Games for a character skin | Lead proposal |
| D16 | Tech stack | **Option A** (Next.js App Router with chat API as Route Handlers, Rust Guardian, separate Node watcher), chosen 2026-11-05; details under "D16" below | Decided 2026-11-05 |
| D17 | Team and repo | Team repository; no `.omp`/model routing in tracked files; no commit-size rule | Decided |

## Further decisions

| Id | Decision | Owner | Status | Needed by | Resolution |
| --- | --- | --- | --- | --- | --- |
| D18 | Guardian custody model | founder | Decided G1, 2026-11-07 | Phase 0 gate | User chose Guardian-held loan; owner position/factory implementation may proceed locally |
| D19 | Demo network | founder | Testnet selected, 2026-11-11 | Phase 0 gate | User selected testnet for the hackathon; fresh-price versus fixed-price demo feasibility remains to be observed |
| D20 | Submitter and GitHub owner | founder | Decided 2026-11-04 | P6.5 | 0xlann submits; repository `github.com/0xlann/mr.fund` |
| D21 | Project skills tracked in git | founder | Decided 2026-11-04 | done | `.claude/skills/` committed with `skills-lock.json` |
| D22 | Branches | founder | Decided 2026-11-04 | done | `main` and `dev` pushed to `origin` |
| D23 | Visual design doc | founder | Decided 2026-11-04 | first frontend task (P4.4) | `docs/DESIGN.md` is skipped until frontend work starts |
| D24 | Fee pricing | founder | Provisional REF Guardian fees approved 2026-11-13; final/mainnet open | P5.1 | Fixed-price testnet conversion below; manual execution remains USDC.e |
| D25 | LLM model | lead | Open; default `anthropic/claude-haiku-5-5` chosen by the user 2026-11-13, not yet accepted | P3.4 | Choose from the live NEAR AI catalog by multilingual tool-calling eval |
| D26 | Character rendering | founder (with D16) | Open | P4.4 | Options listed under D16 |
| D27 | Guardian trigger verification | lead | Open, depends on Gate 3 | P2.5 | On-chain verification preferred; fallback drops the per-action fee |
| D28 | Default comfort line and trigger | lead | Lead proposal | P1.5 | Comfort line health 150%, trigger default 120%, user-editable |
| D29 | Watcher hosting | founder (account, cost) | Open, follows D16 | P5.3 | Options in D16 hosting table |
| D30 | Protocol rate convention | user | Decided 2026-11-06 | P1.4 | Use Rhea APR fields end to end; rename shared types, engine and tools; no implicit APY conversion |
| D31 | Dual browser login | user | Decided 2026-11-08 | P4.3 login slice | NEAR Auth hosted social/passkey onboarding plus NEAR Connect ecosystem wallets; no account linking, session keys or new spending authority |

### D16. Tech stack (Open)

Context: Mr.Fund needs a web app with wallet signing, a server boundary that keeps the LLM key secret and runs deterministic tools, a Rust NEAR contract for the Guardian, and a watcher that requests Guardian actions. All versions below were observed live on 2026-11-04 (`npm view`, crates.io API, Rust stable channel manifest, Node release index); sources in [ARCHITECTURE](technical/ARCHITECTURE.md#selected-stack-and-historical-alternatives-d16). None was installed or built at that observation date.

Shared core in every viable option: TypeScript 7.0.2 and React 19.3.1; wallet connection `@hot-labs/near-connect` 0.12.0 (what docs.near.org currently teaches) with `near-api-js` 7.4.0 for RPC; Rust `near-sdk` 5.30.0 (MSRV Rust 1.95; current stable 1.99.1), `cargo-near` 0.22.0 (stable; 0.23.0-rc.2 excluded), `near-workspaces` 0.24.0 for sandbox tests; NEAR AI Cloud through the `openai` 7.50.0 client; finance math on native `BigInt`; Vitest 5.1.0; Playwright 1.64.1; Node 24.22.2.

| Option | Shape | Strength | Weakness |
| --- | --- | --- | --- |
| **A (lead recommendation)** | Next.js 16.4.5 (App Router; chat and tool endpoints as Route Handlers) + Rust Guardian + a separate always-on Node watcher | One TypeScript codebase for UI, API and engine; conventional runtime for signing; contract enforces the policy | Needs a paid always-on host for the watcher (Railway Hobby USD 5/month or Fly.io about USD 2.19 per 30 days, both verified pricing pages) |
| B (rejected for Guardian) | Same frontend; Guardian = a function-call access key on the user's account plus server-side policy checks | Fastest to code | Function-call keys cannot attach even 1 yoctoNEAR, and both `ft_transfer_call` and Rhea `execute` require exactly 1 yoctoNEAR, so the key cannot repay at all. Keys restrict receiver and method names, never amounts. No honest "the contract rejected it" claim, no AI Security track |
| C | Vite 8.3.5 static app + Cloudflare Worker (`fetch` for chat, Cron `scheduled` for the watcher) + the same Rust Guardian | Serverless, cheap, no always-on process | Free plan allows 10 ms CPU per invocation; paid sub-hourly cron gets 30 s CPU; minute-level cadence only; `near-api-js` signing inside Workers unproven; cron edits can take 15 minutes to propagate |

Recommendation [I]: **A.** It has the same security core as C with fewer unproven runtime assumptions, and B cannot perform the Guardian's job. Choose C only if minute-scale checks are acceptable and a Worker signing spike passes.

Character rendering (part of this decision, D26), listed without choosing: sprite state sheets with CSS (no runtime, high art cost); `lottie-react` 3.1.2; `@lottiefiles/dotlottie-react` 0.21.1 (WASM player, state machines); `@rive-app/react-canvas` 4.38.0 (interactive state machines, highest rig cost); SVG with `motion` 14.9.1; SVG with `gsap` 3.15.1. Whatever is chosen, text and numbers carry the financial state; animation never does alone.

**Resolution (2026-11-05):** Option A, chosen in a coding session after the question "can the backend be NestJS?" was answered. A NestJS `apps/api` (variant A′) was offered and not chosen: the backend is one streaming chat endpoint plus a separate watcher, so Route Handlers are enough and add no extra deployable. If a NestJS API is wanted later, keep it a separate process from the watcher (the chat process holds only the LLM key, the watcher only its function-call key). Package manager: pnpm 12.14.0. Lint and format: Biome 2.6.5 (lead choice, code files only). D26 (character rendering) and D29 (watcher host) remain open. The scaffold is BUILD-PLAN P0.7.

### D18. Guardian custody model (Decided G1, 2026-11-07)

**How Rhea lending decides whose debt is repaid** [V, `ref-finance/burrowland` commit `2110c7047f2d72a9189abcbaad5eafb4e4a87f9e`, read 2026-11-04]:

- `execute(actions)` requires 1 yoctoNEAR and applies every action to `env::predecessor_account_id()`, the account that called it.
- `Repay(AssetAmount)` and `PositionRepay { position, asset_amount }` carry no borrower field; they repay the caller's own debt from the caller's own supplied balance.
- A token transfer with message `"OnlyRepay"` repays the debt of the token's `sender_id`.
- The full list of transfer messages is `Execute`, `ExecuteWithPyth`, `DepositToReserve`, `DepositToMargin`, `MarginExecute`, `MarginExecuteWithPyth`, `SwapReference`, `OnlyIncreaseCollateral`, `OnlyRepay`. None names a beneficiary.
- `Liquidate` does repay another account's debt, but only when that account is already unhealthy, and the liquidator takes discounted collateral. That is not protection.

So a Guardian contract that holds a reserve can only repay **its own** Rhea debt. It cannot repay a loan that lives in the user's wallet account. A wallet function-call key cannot fill the gap either: it cannot attach the 1 yoctoNEAR these calls require [V, docs.near.org access keys and one-yocto pages, read 2026-11-04].

What source does allow [V]: a contract account can run the full cycle as itself. Register with `storage_deposit` (live minimum 0.1 NEAR on mainnet and testnet), supply tokens with `ft_transfer_call`, `IncreaseCollateral`, `Borrow` (which credits the borrowed amount as supplied balance), `Withdraw` (which sends tokens to the calling contract), and `Repay` or `OnlyRepay`. No externally-owned-account check or integration whitelist exists in these paths.

Caveat [U]: the deployed contracts do not match the published source. Mainnet `contract.main.burrow.near` reports `get_version` `0.16.2`, the testnet contract `contract.1689937928.burrow.testnet` reports `0.11.0`, and the public source is `0.15.7`. Phase 0 proves the behavior on the deployed contract (BUILD-PLAN P0.3).

| Option | How it works | What the user gets | What it costs | Claims we can make |
| --- | --- | --- | --- | --- |
| **G1 Guardian-held loan (lead recommendation)** | "Activate Guardian" creates a Guardian account the user owns (a per-user contract account with no access keys). The protected loan lives in it: the user deposits collateral into the Guardian, borrows through it (borrowed tokens go to the user's wallet), and funds a reserve. The watcher can only call `request_repay`; the contract checks the policy and repays its own debt | Real automatic protection within contract-enforced limits; the user stays owner and can pause, deactivate and withdraw at any time | Existing wallet loans must be opened in, or moved into, the Guardian (repay in the wallet, withdraw, redeposit, re-borrow); per-user account storage plus 0.1 NEAR Rhea registration; more contract surface (owner position methods) | Unstoppable DeFi; AI Security if the over-limit rejection is shown on-chain (D15) |
| G2 Prepared repay only | No contract custody. The watcher detects risk and prepares a repay card; the user signs it in the wallet | Works on any existing wallet loan, no move step | No automation while the user is away; the "contract says no" demo beat disappears | Unstoppable DeFi only; no automatic protection claim |
| G3 G1 plus G2 for wallet loans | G1 for automation; wallet loans also get G2 alerts and cards | Both | G1 cost plus alert plumbing | As G1 |

Recommendation [I]: **G1**, with wallet loans served by chat, cards and manual repay (F1 to F5). The cards already give the G2 experience, so G3 needs little extra beyond alerts. The demo then shows a Guardian-held loan for steps 5 to 7 of the never-cut demo.

Decision [user, 2026-11-07]: **G1 — Guardian-held loan**. This resolves B1 and permits local owner-position/factory work. Existing wallet loans remain manual repay/card flows; no automatic repayment on behalf is claimed. The user subsequently selected testnet and authorized account creation/funding; B7 token sourcing and the other named gates still apply to dependent operations. Final provisioning ABI/storage evidence remains required before factory-dependent activation builders.

### D19. Demo network (Testnet selected; feasibility evidence pending)

Decision [user, 2026-11-11]: focus the hackathon on testnet and authorize creation and faucet funding of the testnet accounts. This selects the target network; it does not establish that fresh-price lending or the Guardian loop works. Record the actual Gate 1 result before claiming acceptance or selecting which demo beats are Simulated. Mainnet deployment or transactions are not authorized.

Observed facts [V, read-only RPC views, 2026-11-04]:

- Testnet lending `contract.1689937928.burrow.testnet` (`0.11.0`) answers `get_config`, `get_assets_paged`, `get_account` and `storage_balance_bounds`. Its config enables the Pyth-compatible oracle path (`pyth_oracle_account_id: "pyth-oracle.testnet"`, `pyth_price_valid_duration_sec: 60`).
- The USDC and DAI price feeds it maps returned `null` from `pyth-oracle.testnet` `get_price_no_older_than(age: 60)`. In source, a null price aborts any action that needs prices (borrow, collateral release with debt); repay and deposit need no prices.
- `wrap.testnet` and `ref.fakes.testnet` use a fixed `default_price`, which bypasses freshness. With those assets, health never moves with the market.
- No public Rhea lending testnet UI was found (`testnet.rhea.finance/lending` returned only an app shell).
- Mainnet `contract.main.burrow.near` (`0.16.2`) uses `aggregate-oracle.near` with a 60 s price validity. Rhea showed USDC at 14.01% supply versus 21.00% borrow on 2026-11-02 (relay snapshot).
- The event accepts testnet-only entries [V, EVENT.md].

| | Testnet | Mainnet with tiny amounts |
| --- | --- | --- |
| Money at risk | None | Real funds in unaudited Guardian code; capped by the founder |
| Eligibility | Accepted | Accepted |
| Lending contract | `0.11.0`, older than the public source | `0.16.2`, newer than the public source |
| Prices | Stablecoin feeds null today; fixed-price assets do not move | Live aggregate oracle |
| Rates | Testnet utilization, not meaningful | Real market rates; the repay-versus-yield story uses real numbers |
| Liquidity and tokens | Fake tokens; how to obtain listed `usdc.fakes.testnet` is [U] | Real USDC and NEAR needed |
| Approvals | Lead may deploy and transact on testnet (accounts per B7) | Every deploy and transaction needs founder approval and funding |
| Judge credibility | Lower if prices are fixed; must label Simulated beats | Highest: a real position and real receipts |
| Speed of iteration | Fast and free | Slow: each mistake costs money |

Planned testnet feasibility ladder [I]; results still need evidence at the Phase 0 gate:

1. **Testnet with fresh prices.** Pyth on NEAR is pull-based [I, to be proven]: P0.2 tries to post a fresh USDC price update to `pyth-oracle.testnet` and then borrow. If borrowing works, every demo transaction is real on testnet, and only scripted price shocks are labelled Simulated.
2. **Testnet with fixed-price assets** if step 1 fails. Supply `wrap.testnet` and borrow a fixed-price asset; every transaction is still real, but any price-driven beat (Guardian trigger) is labelled Simulated, and the trigger is exercised by the over-limit rejection plus a labelled replay.
3. **Mainnet with tiny amounts** only if the founder approves a hard cap after seeing steps 1 and 2. Development always runs in a local sandbox with the deployed mainnet Rhea code imported (P0.3), so mainnet is a deployment target, not a development environment.

Read-only mainnet views may be used at any time to validate the engine against real positions (P1.4); they move no money.

Blocker: B2. Founder response 2026-11-04: "mainly on testnet but make it open decisions again and make like the table … whats the best solution for that". Affected docs: PRD never-cut demo, INTEGRATIONS, BUILD-PLAN P0.2 and P5.5.

### D20. Submitter and GitHub owner (Decided 2026-11-04)

Founder answer: "0xlann submits, GitHub 0xlann". The repository is `https://github.com/0xlann/mr.fund`; every commit is authored by the repo-local identity `0xlann`. The founder, who already holds the CONSTITUTION and THE RULE entries, is not on this entry. Team members beyond 0xlann are [U]; the submission team-size bucket is filled at P6.5. If 0xlann joins another entry, both READMEs must name each other (event rule); open question in B9.

### D21. Project skills are committed (Decided 2026-11-04)

The founder overruled the handoff's ignore rule: `.claude/skills/` is tracked so every teammate's agent gets the same skills on clone. `skills-lock.json` stays as provenance and integrity record (pinned revisions plus content hashes). Third-party license texts live in `.claude/skills/LICENSES/`. Licensing gap for five skills: B10.

### D22. Branches (Decided 2026-11-04)

`origin` = `https://github.com/0xlann/mr.fund.git`. `main` holds reviewed work; `dev` is created from `main` for ongoing build work [I: build commits land on `dev`, and `main` moves by reviewed merges].

### D23. Visual design doc deferred (Decided 2026-11-04)

Founder: skip `docs/DESIGN.md` until frontend-related work exists. PRD "Functional screen contracts" fixes behavior; BUILD-PLAN P4.4 starts with writing DESIGN.md from the founder's references.

### D24. Fee pricing (Provisional testnet decision; final/mainnet open)

[V, owner authorization, 2026-11-13] Guardian debt is `ref.fakes.testnet` (18 decimals), recipient `fee-mrf-b1ce96af6a.testnet`. The owner approved the following fixed-price conversion of the 2026-11-11 USDC.e Guardian fees. Manual execution is unchanged.

| Fee | Testnet token | Token amount | Token atomic units |
| --- | --- | ---: | ---: |
| Guardian activation, once | REF | 0.4 | `400000000000000000` |
| Guardian automatic action, per settled repay | REF | 0.004 | `4000000000000000` |
| Manual execution, per action | USDC.e | 0.01 | `10000` |

[V, read-only testnet, 2026-11-13, final block 277467441] Rhea maps REF to `default_price {multiplier:"250", decimals:20}` with token decimals 18: `250 / 10^(20-18) = 2.5` USD per REF. Therefore the earlier 1 USDC.e activation corresponds to `1 / 2.5 = 0.4` REF and the 0.01 USDC.e action to `0.01 / 2.5 = 0.004` REF. This is a fixed testnet protocol price, not a market quote. wNEAR's fixed value is `960 / 10^(26-24) = 9.60` USD.

[V, owner authorization in chat, 2026-11-13] The local web configuration (`apps/web/.env.local`, not committed) charges the **manual execution** fee in REF as well: `FEE_TOKEN_ID=ref.fakes.testnet`, `FEE_EXECUTION_ATOMIC=4000000000000000` (0.004 REF, the same fixed-price conversion), with the Guardian values above. Reason: the chat builds a repay card only when the fee token is a priced asset of the position snapshot; testnet USDC.e has no oracle price, so with USDC.e as the fee token `propose_card` refused every repay (observed for `my-dev.testnet`; its refusal text says "No wallet is connected", which is misleading for this cause). This deviates from "manual execution remains USDC.e" for the testnet demo only; it is not final pricing. The fee recipient was not registered on REF at that time (`storage_balance_of` returned `null`), so the card adds the NEAR registration step.

These are testnet-only demo values, not measured costs, final product pricing or mainnet approval. P1 managed-placement pricing remains open. Guardian activation is fixed in the factory template; `action_fee` is a field of the owner-signed policy, not a template field. The UI must disclose and use the approved amount. D27 fallback, if separately selected, drops the action fee; it has not been selected. The owner separately authorized this wave's factory deployment and fee-recipient registration, but not demo-user Guardian creation or mainnet signatures.

### D25. LLM model (Open, lead)

Live NEAR AI Cloud catalog (`https://cloud-api.near.ai/v1/models`, read 2026-11-04) lists `Qwen/Qwen3.8-27B` (`supported_features: tools, structured_outputs, reasoning`; USD 0.04 per million input tokens, USD 1.35 per million output) and `z-ai/glm-5.3-flash` (tools, structured_outputs, reasoning, json_mode; USD 0.08 per million input, USD 0.50 per million output). Tutorial ids such as `zai-org/GLM-5.1-FP8` were absent from the live catalog. No provider-wide language guarantee exists. Choose by the P3.4 multilingual tool-calling eval; record the winner here.

[V, 2026-11-08] The user selected `z-ai/glm-5.3-flash` for implementation and supplied local access (B6 resolved); this is not acceptance of its quality. The refreshed official catalog and four complete live runs, exact-decimal observed cost estimates and current generation settings are summarized in [CHAT-API](technical/CHAT-API.md#observed-evidence-2026-11-08). Qwen was not inferred against or compared.

**Historical blocker (2026-11-08):** that complete run produced 34/36 model answers and two guarded comparison fallbacks (`comparison.id`, `comparison.es`). Automated number/card/claim and language-heuristic checks passed, but comparison content failed. Independent assistant review of all 36 exact outputs completed at `2026-11-08T04:44:14.735636Z`: 36/36 correct language, 22 content/honesty approvals and 14 rejections, including provenance uncertainty; this is not human review or provider self-assessment. Findings and the ignored review artifact are summarized in CHAT-API. A later two-case repeat succeeded after rejecting an invented-number/unsupported-assurance candidate; it does not replace the complete dataset.

[V, 2026-11-13] Full rerun (`runAt: 2026-11-13T05:07:58.374Z`, same model/settings, explicitly **Simulated** fixture) completed: **20/36 model answers, 16 timeouts**, 36/36 numeric and forbidden-claim checks passed, **20/36 automated content**, **35/36 card**, **33/36 language heuristic** passes; **36 independent reviews pending**. Mean/max latency **50858.671/60025.881 ms**; `modelAccepted: false`. The initial 20-minute harness expired before a full report; allowing 40 minutes let each case reach its existing 60 s deadline without waiving failures. Full scenario matrix and observed-only usage are in [CHAT-API](technical/CHAT-API.md#live-multilingual-rerun-2026-11-13).

[V, 2026-11-13] Alternative-model comparison on the same **Simulated** fixture and settings (`runAt: 2026-11-13T05:51:41.843Z`, 36 cases each, run concurrently, independent review not done for any of them):

| Model | Model answers | Latency mean / median / max (ms) | Numeric / forbidden-claim | Language heuristic | `modelAccepted` |
| --- | ---: | --- | --- | ---: | --- |
| `z-ai/glm-5.3-flash` (selected, 2026-11-13 rerun above) | 20/36, 16 timeouts | 50858.671 / 55801.304 / 60025.881 | pass / pass | 33/36 | false |
| `anthropic/claude-haiku-5-5` (USD 0.10 / 0.50 per million tokens) | 34/36, 0 timeouts, 7 guard hits in 5 turns | 5915.749 / 5204.965 / 13052.889 | pass / pass | 36/36 | false |
| `google/gemini-3.8-flash` | 9/36, 27 provider-unavailable | 6974.661 / 6783.098 / 11032.077 | pass / pass | 27/36 | false |

Observation, not acceptance: on this run Haiku 5.5 finished every case inside the 60 s budget at roughly one tenth of GLM-flash latency for nearly the same list price. Semantic checks still failed for all three and all 36 independent reviews are pending per model, so no model is accepted. A `z-ai/glm-5.3` run was started and cancelled before it produced a report. Switching the model is an owner decision (`NEARAI_MODEL`); none was made.

[V, 2026-11-13] Two further complete Haiku 5.5 runs on the same Simulated fixture showed that `max_tokens: 1024` cut eight answers off mid-sentence; at 2048 (now the default setting for every model) one was cut, 34/36 model answers, 0 timeouts, mean 6135 ms, numbers/claims/cards and language heuristic all passing, 9 semantic failures (two guard fallbacks, one cut-off, six rubric mismatches on correct wording). `modelAccepted: false`; no independent review; no model switch. Details: CHAT-API "Haiku 5.5 runs and the token limit".

[V, 2026-11-13] The user set `anthropic/claude-haiku-5-5` as the default model (`NEARAI_MODEL`). After guard-feedback, persona, `max_tokens` 3072 and user-approved rubric changes, one of two locked-rubric final runs passed every automated gate (36/36 model answers and content). Its independent assistant review (not human) rejected six answers: invented "below 1" thresholds in all three glossary answers (the number guard admits small prose integers), a backwards repay/liquidation claim, reassuring judgments, and a missing data age that conflicts with the owner-approved persona rule. `modelAccepted: false`; D25 stays open with the default chosen but not accepted. Details: CHAT-API "Haiku 5.5 acceptance attempt". Raw reports stay in ignored `scratch/chat-eval/`.

**Current BLOCKER (owner: lead):** D25/P3.4/OpenSpec 3.3 remain open. The required complete live inference/content/card/language gates and independent exact-output review are not met; no deployment readiness or alternative model selection is claimed. Separately, the final public-position latency run still timed out on all three English explanation and price-shock repeats even with FastNear and the 60 s cap; numeric guards were not bypassed.

### D26. Character rendering (Open)

Options under D16. Decided together with the founder's visual references when DESIGN.md is written (D23).

### D27. Guardian trigger verification (Open, lead, depends on Gate 3)

Preferred: the Guardian contract verifies the trigger itself. Inside `request_repay` it reads its own Rhea account, the asset configs and fresh prices from the oracle Rhea uses (`get_price_no_older_than` with the configured age), computes health with Rhea's formula, and rejects if health is at or above the trigger or any price is stale. Fallback, if P0.4 shows this is impractical (gas or interface): the trigger stays a watcher rule, and the contract still enforces caps, floor, cooldown, action and target. In that case **the per-action fee is dropped**, so the watcher operator earns nothing from unnecessary repays, and the disclosure changes to "a faulty watcher can repay early, within your limits; that only reduces your debt".

Local composed evidence [V, 2026-11-07]: the preferred read → repay → resolver → fee chain fits an explicitly asserted 300 Tgas root budget on both imported Rhea versions, with >31 Tgas trigger-callback and >17 Tgas settlement continuation margin. Actual Guardian tests include fee failure and pause during reads; controlled partial/full-refund fixtures are distinguished from deployed Rhea surplus behavior. See [GUARDIAN-SETTLEMENT](technical/GUARDIAN-SETTLEMENT.md). This permits the local preferred implementation; D27/B4 public feasibility remains open pending the selected network's actual token/oracle and D18/D19/B7. No fallback or public deployment is authorized by this result.

### D28. Default comfort line and trigger (Lead proposal)

The character's "calm" line is health ≥ 150%; the Guardian trigger default is 120%; the contract minimum trigger is 105%. These are lead proposals [I] to keep a buffer above Rhea's liquidation boundary at 100%. Both are user-editable; none is presented as a safety guarantee.

### D29. Watcher hosting (Open)

Follows D16: Option A needs an always-on Node host (Railway or Fly.io; Render's free tier sleeps after 15 minutes without inbound traffic, so it is unsuitable); Option C uses Cloudflare Cron. Founder owns the account and cost.

### D30. Protocol rate convention (Decided 2026-11-06)

Live testnet and mainnet `get_assets_paged_detailed` return decimal strings `supply_apr` and `borrow_apr`, contradicting the APY-only shared types. The user explicitly chose APR end to end during P1.4. Interfaces now use `supplyAprBps`, `borrowAprBps` and `yieldAprBps`, without old-name aliases. Supply floors and borrow ceils to integer basis points using exact arithmetic. Preserve the protocol's naming without claiming an APR/APY conversion or exact future compounded returns. This supersedes APY assumptions in historical test evidence.

### D31. Dual browser login (Decided 2026-11-08)

The user approved implementing `add-dual-near-auth` on a new branch from merged `dev`. Offer NEAR Auth hosted login and NEAR Connect wallets, preserving one explicitly selected network/account. Passkey/fingerprint availability belongs to the hosted tenant/device; login does not remove transaction approvals or change Guardian permissions. Mainnet Auth needs approved client credentials; D19 remains open. Named Auth account provisioning, funding, transaction submission and server authentication are outside this login slice.

Execution scope update [V, user instruction, 2026-11-08]: stop all UI-related work for now. Finish the NEAR Auth/NEAR Connect adapters, account controller and non-UI verification only. React context/root wiring, `/connect`, DESIGN and app-level real-login proof are deferred to frontend integration; dual-login product intent is unchanged. The existing app UI must remain unchanged.

The user also superseded D17's historical lack of a commit-size rule for subsequent work: **50–350 added/deleted lines per coherent commit**, including tests/docs/generated changes. No automatic merge is authorized.

## BLOCKERS

| Id | Missing prerequisite | Owner | Status | Blocks plan ids | Next action / proof |
| --- | --- | --- | --- | --- | --- |
| B1 | Guardian custody choice (D18) | founder | Resolved G1, 2026-11-07 | P2.4, P2.6, P5.1, P5.5 | User explicitly selected G1 Guardian-held loan; public network/funding gates remain separate |
| B2 | Demo network choice and Gate 1 proof (D19) | lead runs probes, founder decides | Open | P0.2, P5.5, P6.4 | P0.2 result: fresh USDC price on testnet and a borrow transaction, or fallback |
| B3 | Gate 2 proof on deployed Rhea code | lead | Open | P0.3, Phase 2 | Contract-owned position completes supply, collateral, borrow, withdraw, repay and release on testnet and in a sandbox with mainnet code imported |
| B4 | Gate 3: in-contract trigger price source | lead | Open | P0.4, P2.5 | Contract reads a fresh price and computes the same health as the engine, or D27 fallback |
| B5 | Tech stack (D16) | founder | Resolved 2026-11-05 | P0.7 and every app path | Option A chosen; see D16 |
| B6 | NEAR AI Cloud API key and credits | founder | Resolved for local inference, 2026-11-08 | P0.6, Phase 3 | Local credential accepted by authenticated gateway; real GLM tool-calling turns exercised. Model acceptance is separate D25/P3.4 evidence; no credential is committed |
| B7 | Testnet accounts, NEAR and listed test tokens | founder creates or authorizes the lead | Resolved 2026-11-11 | P0.2, P0.3, P2.8, P5 | Six accounts funded; wrapping and testnet USDC sourcing observed. See INTEGRATIONS "NEAR testnet accounts" |
| B8 | Watcher host account (D29) | founder | Open | P5.3 | After D16 |
| B9 | Team members and other entries of 0xlann | 0xlann | Open | P6.3, P6.5 | Confirm the team list and whether 0xlann is on another entry (READMEs must name each other) |
| B10 | License of five committed skills | founder | Open | none (risk) | `near-api-js`, `near-dapp`, `near-ai-cloud` and `near-contract-audit` have no upstream license; `motion` declares MIT only in a package manifest. Accept, or untrack these five and restore them from the lock |
| B11 | Name and domain availability (D1 [U]) | founder | Open | P6.3 | Check before the public post |

### B1. Guardian custody

Attempts: source inspection of every Rhea repay path (D18). Missing input: the founder's choice. Work that can proceed now: the contract's policy core (P2.1 to P2.3) is identical under G1 and G3. Under G2 it is not deployed, so Phase 2 starts with the policy core and pauses before the owner position methods (P2.4) until B1 resolves.

### B2. Network and Gate 1

Attempts: read-only views listed in D19. Missing: proof that a stablecoin can be borrowed on testnet with a fresh price. Unblock evidence: transaction hashes for supply, borrow, withdraw and repay on testnet, recorded in INTEGRATIONS.

### B3. Deployed-code parity

The public source is `0.15.7`; deployed versions are `0.11.0` (testnet) and `0.16.2` (mainnet). Unblock evidence: the P0.3 probe contract's cycle on testnet, plus the same cycle in `near-workspaces` with the mainnet wasm imported (if import works; otherwise recorded as a limit).

### B4. Trigger price source

Unblock evidence: sandbox test showing the Guardian computes health from a live-shaped price response and rejects a stale or null price; gas used per check recorded.

### B6. LLM access

[V, 2026-11-08] The user supplied a local key and selected `z-ai/glm-5.3-flash` as the initial model. Authenticated gateway access, actual tool-call inference, and local HTTP chat with public Rhea reads succeeded. B6 is resolved for local inference; token/latency/quality evidence belongs to D25/P3.4 and [CHAT-API](technical/CHAT-API.md). Keys remain local and must never be committed or printed.

### B7. Accounts and tokens

On 2026-11-11 the user authorized account creation and faucet funding. Six testnet accounts were created and initially verified with 10 NEAR each. The demo user then wrapped 0.1 NEAR and swapped it for `usdc.fakes.testnet`; the failed first attempt and successful corrected transaction are recorded in INTEGRATIONS. Private keys are in the local gitignored `.env` per user instruction. B7 is resolved for account and token access; oracle, deployment and fee decisions remain separate gates.

### B10. Skills licensing

Upstream facts in INTEGRATIONS "Skills". The repository will be public by the deadline, so committed copies are redistribution. The conservative fix is one commit: add the five paths to `.gitignore`, remove them from the index, and restore them locally from `skills-lock.json`.
