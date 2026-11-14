# Mr.Fund: product requirements

## TL;DR

- **One-liner [I]:** Mr.Fund is the DeFi manager you can talk to: he explains your position in plain words, shows you the smartest move, and acts only within limits you set.
- **Status:** product scope approved by the founder on 2026-11-04 (decisions D1 to D17 in [OPEN-DECISIONS](OPEN-DECISIONS.md)). D16 Option A was decided on 2026-11-05. Engine, reads, manual repay builders, agent tools and Guardian policy/reserve lifecycle have local implementation evidence in BUILD-PLAN; the full product loop and public deployment remain incomplete.
- **What it is:** a real DeFi app with a game-like character (D2). Not a simulation, not a course, not a trading bot. One character, one lending protocol, one position, one complete real loop.
- **P0 loop:** ask → Mr.Fund reads the real position → explains in plain words → recommendation card → Adjust or Execute now → wallet approval (or Guardian policy) → receipt → follow-up questions.
- **Primary success condition:** a judge watches a real Rhea lending position get explained, a real repay transaction get signed and receipted, and a real Guardian contract **reject** an over-limit action, all on the demo network (D19, open).
- **Phase 0 decisions:** D16 is resolved and user selected D18 **G1 Guardian-held loan** on 2026-11-07; demo network D19 remains open. Rhea repays only the caller's own debt, so automation requires the loan to live in the Guardian. Factory/provisioning and public deployment still need their separate evidence; see [OPEN-DECISIONS](OPEN-DECISIONS.md).
- **The three rules that never bend:** the AI talks; deterministic code decides numbers; the contract decides permissions.

## Problem, users and buyer

**Problem [I, grounded in V facts].** Borrowing on a lending protocol is easy to start and hard to understand while it is open. The user sees a health factor, two APYs and a liquidation price, and must work out alone:

- Is my loan getting more dangerous, and how close is liquidation?
- Is it smarter to repay now or to put spare money to work?
- What happens to me if the collateral price drops 20%?

The cost of not knowing is real. On Rhea lending, liquidation begins below health factor 100% and the liquidator's discount grows as health falls, `(1 - health_factor) / 2`, for example 6.25% at 87.5% health [V, Rhea liquidation guide, read 2026-11-02, S26]. On 2026-11-02 Rhea displayed native USDC at 14.01% supply APY versus 21.00% borrow APY [V, relay snapshot, S20]: with those rates, 500 USDC of spare cash earns about 70.05 USDC a year in the vault but avoids about 105 USDC a year of interest if used to repay [I, arithmetic, illustrative only; rates move]. Many "make your yield pay your interest" pitches hide exactly this.

**Existing workaround [I].** Protocol dashboards show numbers without judgment. Spreadsheet math. Protection bots on other chains (DeFi Saver on Ethereum, BRACE on Solana) that require trusting a configuration screen the user rarely reads. Generic AI chatbots that confidently invent rates.

**Primary user [I].** An existing or new borrower on Rhea lending (NEAR) with one stablecoin debt against volatile collateral, who is comfortable connecting a wallet but does not want to do risk math. Many are not fluent in English (D5).

**Later users [I].** DeFi beginners who have spare funds and want a guided first placement (P1 investment assistant), then multi-protocol borrowers (future).

**Buyer [I].** The same person. They pay a disclosed fee for Guardian protection and for actions executed through Mr.Fund (D12). Willingness to pay is [U].

**Job to be done [I].** "Tell me, in my language, whether my loan is fine; if it is not, show me the best move with real numbers and let me do it in one approval. If I'm not watching, protect me within limits I chose."

## Insight and necessity

**Mechanism [I].**

1. A character the user actually talks to lowers the cost of asking. The conversation is the interface; cards are the commitments.
2. Every number on screen comes from a deterministic finance engine that implements the protocol's documented rules on live position data. The LLM calls the engine as a tool and explains the output; it never produces a rate, health factor or amount itself.
3. Manual actions are signed by the user's own wallet. Mr.Fund never holds a private key (D8).
4. Automatic protection is a NEAR smart contract (the Guardian) that holds a user-funded reserve and enforces the user's policy: one allowed action, one target, a maximum amount, a reserve floor and a trigger threshold. An off-chain watcher can only **request** an action; the contract decides. A request outside the policy is rejected on-chain, visibly.

**Why each primitive is load-bearing.**

| Primitive | Why it is needed | When something simpler wins |
| --- | --- | --- |
| Rhea lending (NEAR) | The debt, collateral and liquidation rules are real and live there [V, S14] | A testnet lending contract exists but its stablecoin prices were null on 2026-11-04; Phase 0 Gate 1 and D19 decide the network (B2); we never fake a position |
| NEAR smart contract (Guardian) | Turns plain-language limits into rules that bind even if the watcher or the AI misbehaves. Rhea repays only the caller's own debt [V, burrowland source, 2026-11-04], so the Guardian must hold the protected loan itself (D18 G1) | If the founder picks G2, or Gate 2 fails on the deployed contract, Guardian narrows to a prepared transaction the user approves, and automation and AI Security are not claimed (B1, B3) |
| Deterministic finance engine | Numbers must be reproducible and testable; LLM arithmetic is neither | Always required |
| LLM with tool calling | Multilingual explanation and intent understanding (D5) | If the LLM is unavailable, the position panel and cards still work with English template text |
| Character | Makes a frightening subject approachable; states mirror real risk | The character is never the security boundary and never hides a number |

**Removal test [I].** Remove NEAR and the Guardian loses its on-chain enforcement and the Rhea position it protects; another smart-contract chain could rebuild it, but not this product on this protocol. Remove the LLM and the product becomes a dashboard: still useful, no longer conversational or multilingual. Remove the engine and the product becomes unsafe.

## Never-cut demo

Target length about 3 minutes. Everything below is real on the demo network (D19) unless labelled **Simulated**. Amounts are illustrative and will be replaced by the observed values from the rehearsal. Steps 1 to 4 use the user's wallet loan. Under D18 option G1, steps 5 to 7 use a **Guardian-held loan**: activation creates the user's Guardian account, and the user deposits collateral and borrows through it before the demo starts or as part of step 5.

1. **Meet Mr.Fund (0:00-0:20).** User connects a wallet. Mr.Fund greets them, reads the real Rhea position and summarizes it: collateral, debt, health factor, estimated liquidation price, data age. Character state: calm.
2. **The gasp question (0:20-1:00).** User types: "make my yield pay my interest". Mr.Fund answers with engine numbers: "Your loan costs 21.00% a year; that vault pays 14.01%. Parking 100 USDC there earns about 14.01 a year; repaying 100 USDC saves about 21.00. Repaying wins." A recommendation card appears: action, reason, numbers, assumptions, fee, risks, **Adjust** and **Execute now**.
3. **Execute (1:00-1:30).** User taps Execute now, approves in their wallet, and the card turns into a receipt: status, transaction link, new health factor read back from chain. Character state: pleased.
4. **Ask in another language (1:30-1:45).** User asks in Indonesian (or Spanish): "Kalau harga NEAR turun 20%, aku aman?" Mr.Fund answers in that language with an engine-computed what-if, labelled as a scenario (D9).
5. **Activate Guardian (1:45-2:20).** User opens Activate Guardian. The form shows position, allowed action (repay USDC debt), max amount per action, reserve to keep, trigger threshold and the fee **before** activation. User funds the reserve and signs. Receipt shows the contract state.
6. **The contract says no (2:20-2:45).** The watcher (or a demo operator, clearly labelled) requests a repay above the max. The contract rejects it on-chain; the rejection transaction is linked. Mr.Fund explains: "I asked for 300; your limit is 100. The contract refused. That's the point."
7. **Ask the Guardian (2:45-3:00).** User asks: "What did you do today and what are your limits?" Mr.Fund answers from real contract state and history.

**Optional beat, only if real (Simulated label otherwise):** a trigger crossing is replayed with a **Simulated** price input on a labelled replay, and the contract accepts a bounded repay. If the network allows a real trigger with real prices, show it unlabelled.

## Features

Priorities: P0 must ship for the demo; P1 only after the P0 loop works end to end; Future is documented, not built. Every P0 maps to tasks in [BUILD-PLAN](BUILD-PLAN.md#traceability-and-ownership).

### F1 Character chat (P0)

- **Outcome:** the user types a question in their own language and gets a short, correct, in-character answer within a few seconds; numbers in the answer come from engine tools.
- **Inputs:** free text in any language the model handles; connected account id; current position snapshot; Guardian state (if any).
- **Outputs:** assistant message (text in the user's language), zero or more tool calls with their results, optional recommendation card (F4), character state.
- **Character states [I]:** driven by data, never by the model's mood.

  | State | Trigger (deterministic) | What it signals |
  | --- | --- | --- |
  | Calm | Health factor at or above the user's comfort line (default: health ≥ 150%), data fresh | Nothing urgent |
  | Concerned | Health below the comfort line, or any input stale beyond its limit, or a failed transaction | Look at this |
  | Pleased | A transaction the user approved confirmed and improved health or reduced cost | It worked |
  | Thinking (transient) | Tool call in flight | Loading, not a mood |

  The 150% default is a lead proposal [I]; the user can change it in settings. It is a comfort line, not a safety guarantee.
- **Language:** reply in the language of the user's latest message; keep protocol names, token symbols and numbers unchanged; format numbers with the user's locale. UI chrome is English in P0 [I]; localized chrome is P1.
- **Rejection cases:** the model cannot answer without data → it says what is missing and why (for example "price data is 7 minutes old; I won't advise on that"). The user asks for something unsupported (another protocol, cross-chain, leverage up) → plain refusal with what Mr.Fund can do instead. LLM provider down → banner "Mr.Fund can't talk right now"; position panel and existing cards still work.
- **Acceptance:** a scripted set of questions in English and two other languages yields answers whose every number matches the engine output for the same snapshot (checked by test harness, see BUILD-PLAN P3.2); no answer contains a number that no tool returned.

### F2 Position reader (P0)

- **Outcome:** an accurate, timestamped picture of one Rhea lending position.
- **Inputs:** account id (the user's wallet account, or the user's Guardian account under D18 G1), network config.
- **Outputs:** `PositionSnapshot` (see ARCHITECTURE data model): supplied and collateral assets with amounts in on-chain integer units and decimals, borrowed assets, per-asset supply and borrow rates as reported by the protocol, asset factors, prices with their source and timestamp, block height, read time.
- **States:** loading, fresh, stale (any input older than its freshness limit), error (RPC failure), empty (no position: Mr.Fund explains how to open one on Rhea; when the opening pair and an approved fee policy are configured, it can draft a collateral deposit card and, only after that deposit is observed in Rhea, a separate borrow card, each reviewed and signed in the user's own wallet; otherwise it offers nothing to execute. Planned and tested locally; not yet exercised in a real wallet).
- **Rejection cases:** unsupported asset in the position → shown, excluded from advice, explained. Prices missing → no health figure shown as current.
- **Acceptance:** for a real position, the health factor computed by F3 from the snapshot matches the value the Rhea app displays for the same account and moment (a public mainnet account, read-only), within a tolerance recorded in BUILD-PLAN P1.4; testnet has no public lending UI, so testnet positions are checked against recorded fixtures.

### F3 Deterministic finance engine (P0)

- **Outcome:** every number Mr.Fund states is reproducible from inputs.
- **Functions (pure, no I/O):** health factor; liquidation price per collateral asset; repay needed to reach a target health; repay-versus-yield comparison over a stated horizon; what-if under a price shock; Guardian trigger evaluation; fee computation.
- **Rules:** integer arithmetic in on-chain units with explicit decimals; rounding direction documented per function and always conservative (health rounds down, debt rounds up); rates compared over equal horizons; APY versus APR never mixed silently; every output carries its inputs and assumptions.
- **Rate source update [V, D30, 2026-11-06]:** Rhea views return `supply_apr` and `borrow_apr`. Use those protocol-reported APRs end to end: supply floors and borrow ceils to integer basis points. Horizon estimates are linear and do not model compounding. The historical UI APY observation above remains a source observation, not an adapter input; the 21.00%/14.01% engine test is an illustrative APR vector, not a live rate claim.
- **Rejection cases:** missing or stale input → typed error, never a default value; negative or overflowing amounts → typed error.
- **Acceptance:** unit tests with worked vectors from the protocol's documentation and from a recorded real snapshot; property tests (more collateral never lowers health; repaying never lowers health; a price drop never raises health).

### F4 Recommendation card (P0)

- **Outcome:** every recommendation is a concrete, reviewable commitment (D10).
- **Contract:** see [Recommendation card contract](#recommendation-card-contract).
- **Acceptance:** a card cannot render an Execute now button unless its payload was built by deterministic code from validated parameters and its numbers were recomputed within the freshness limit.

### F5 Manual repay (P0)

- **Outcome:** the user repays part or all of a debt from their wallet in one approval and gets a real receipt.
- **Inputs:** card payload (asset, amount in integer units, fee), connected wallet.
- **Outputs:** signed transaction(s) built by deterministic code; receipt with status, transaction hash link, observed new position after a fresh read.
- **States:** draft, awaiting wallet, submitted, confirmed, failed (with the protocol or wallet error in plain words), partially applied (if a batch is split by the wallet; shown explicitly).
- **Rejection cases:** insufficient wallet balance; amount above outstanding debt (capped at debt with the cap shown); stale data at execution time (card asks to refresh); wallet rejects.
- **Acceptance:** a real repay on the demo network (D19) shows a transaction link that resolves in the explorer and a post-transaction health factor read from chain.

### F6 Activate Guardian (P0)

- **Outcome:** opt-in automatic protection, with an extra fee, that can act only within limits the user set (D7, D8).
- **Custody (D18, G1 selected 2026-11-07):** Rhea repays only the caller's own debt, so the Guardian cannot repay a loan held in the user's wallet. The intended G1 flow creates a Guardian account owned by the user (a contract with no access keys), and the protected loan lives there: the user deposits collateral into it and borrows through it, and borrowed tokens go to the user's wallet. Wallet loans keep chat, cards and manual repay (F1 to F5). This is the chosen product design; factory/provisioning execution remains pending its implementation and final ABI.
- **Interactive form fields** (all required unless noted):

  | Field | Meaning | Validation |
  | --- | --- | --- |
  | Position | The Guardian-held loan to protect (G1): its collateral asset and debt asset | One collateral asset and one debt asset in P0 |
  | Allowed action | P0: "Repay this debt asset from my reserve" (only option) | Fixed; other actions are not offered |
  | Debt asset | The token being repaid, for example USDC | Must be in the position's borrowed assets |
  | Max amount per action | Largest single repay | > 0, ≤ reserve minus reserve floor |
  | Max total (lifetime of this activation) | Budget cap across all actions | ≥ max per action; optional with default = reserve minus floor |
  | Reserve to keep | Floor that the Guardian never spends below | ≥ 0 |
  | Reserve deposit | Amount the user funds now | ≥ max per action + one action fee + reserve floor; the activation fee is added on top |
  | Trigger threshold | Health factor below which the watcher may request an action | ≥ 105% (contract minimum, above Rhea's 100% liquidation boundary); default proposal 120% [I] (D28) |
  | Target after action (optional) | Health the engine aims for when sizing a repay | > trigger threshold |
  | Cooldown | Minimum time between actions | ≥ 5 minutes (contract minimum) |
  | Fees | Activation fee and per-action fee, recipient and amounts | Display only; shown before signing; included in the signed payload |

- **Lifecycle:** draft → review (summary in plain words plus every number) → sign activation → active → paused or deactivated by the owner at any time → owner withdraws unused reserve.
- **Behavior:** a watcher (deterministic code, no LLM) evaluates the trigger with the engine and calls the Guardian's `request_repay(amount)` when health is below the trigger. The contract re-checks every policy rule and executes or rejects. Each attempt (executed or rejected) is recorded in contract history and as an event with a reason.
- **Rejection cases (contract-enforced, each with a negative test):** amount above max per action; spend that would breach the reserve floor; total above lifetime cap; action other than the allowed one; asset or target other than the allowed one; caller other than the authorized watcher (or owner); inside cooldown; Guardian paused or deactivated; another action still in flight; trigger condition not met according to the contract's own check with fresh prices (D27; if Phase 0 Gate 3 fails, this check moves to the watcher, the per-action fee becomes zero, and the limit is stated in Risks).
- **Deactivate:** stops future actions immediately; does not reverse past actions; owner can withdraw remaining reserve.
- **Acceptance:** on the demo network (D19), activation, one accepted bounded action (real or labelled replay), one rejected over-limit request with a transaction link, deactivation and reserve withdrawal are all observed.

### F7 Ask the Guardian (P0)

- **Outcome:** the user can ask the Guardian about itself in chat and get answers from real contract state.
- **Questions it must answer** (tools read contract views and events, never memory):
  1. "Are you active?" → status, since when, network, contract account.
  2. "What are my limits?" → every policy field in plain words with numbers.
  3. "How much reserve is left and how much can you still spend?" → reserve, floor, spendable, remaining lifetime cap.
  4. "What did you do?" / "What did you do today?" → executed and rejected attempts with time, amount, reason and transaction links.
  5. "Why didn't you act?" → which rule blocked it (trigger not met, cooldown, cap, stale data, watcher offline).
  6. "What does this cost me?" → activation fee paid, per-action fees paid, recipient.
  7. "What can't you protect me from?" → the honesty list in [Risks and guarantees](#risks-and-guarantees).
  8. "How do I stop you and get my money back?" → deactivate and withdraw steps.
- **Acceptance:** each question above answered correctly against a live Guardian in a scripted test; "What did you do?" includes the rejected over-limit attempt from the demo.

### P1 (after the P0 loop works)

| Id | Feature | Minimum behavior |
| --- | --- | --- |
| F8 | Yield recommendation and deposit | Recommend placing genuinely spare funds in one supported yield option (Rhea supply first) only when it beats repaying under the engine's comparison; card discloses rate source, variability, smart-contract risk and exit conditions; user-signed deposit |
| F9 | Placement monitoring | Mr.Fund watches the placement (D11): rate drop below debt cost, exit liquidity, and tells the user. Automatic exit is a separate, riskier permission and needs its own proof before it is offered |
| F10 | Voice | Speech input and spoken replies as an extra layer (D5); typing remains complete without it |
| F11 | Agent Economy loop | Only if real: the agent pays for a service it needs (for example inference or price data) from a budget, with receipts (D15) |
| F12 | Localized UI chrome | Interface labels in the user's language |

### Future

Cross-chain funding via NEAR Intents (custom testnet endpoint only if proven, D13); multiple protocols and vaults; automated vault exits and rebalancing; extra personalities; evolving room and missions as optional extras (D4).

## Recommendation card contract

Every recommendation renders as an interface card (D10). The card is data built by deterministic code; the LLM may write the `reason` prose only.

| Field | Source | Rule |
| --- | --- | --- |
| Action | Engine | One of: `repay`, `guardian_activate`, `guardian_deactivate`, `guardian_withdraw` (P0); `deposit` (P1) |
| Headline | Engine template | For example "Repay 100.00 USDC" |
| Reason | LLM, in the user's language | Must not contain numbers that are not in the Numbers block |
| Numbers | Engine | Before and after: debt, health factor, liquidation price, annual cost or saving; each with units |
| Assumptions | Engine | Prices and their timestamps, rates and their source, horizon, rounding |
| Fees | Engine | Each fee: amount, token, recipient account, when charged |
| Risks | Static list per action plus dynamic warnings | For example "Rates change", "This does not remove liquidation risk" |
| Why this? | LLM, expandable | Plain-language explanation (D14) |
| Data age | Engine | Oldest input age; card blocks Execute if above limit |
| Buttons | UI | **Adjust** (edit amount within validated bounds; numbers recompute) and **Execute now** |

**After execution the card becomes the receipt:** status (submitted, confirmed, failed), transaction hash with explorer link, observed result (new debt, new health read from chain), fees actually paid, time. A receipt is shown only after the transaction outcome is observed; failure states say what failed and what to do next.

## Functional screen contracts

Visual design waits for frontend work (founder, 2026-11-04: DESIGN.md is skipped until then). These are behavioral contracts only.

| Screen | Purpose | Must show | States |
| --- | --- | --- | --- |
| Welcome / connect | Explain in one sentence; NEAR Auth hosted login or NEAR Connect ecosystem wallet (D31) | Network badge, full selected account, account-switch/sign-out, what login does not authorize | Checking, disconnected, connecting, wrong network/configuration, connected, recoverable error |
| Main | Character, chat and position side by side (stacked on narrow screens) | Character with state, chat thread, position panel (collateral, debt, health, liquidation price, data age), Guardian badge | Loading, fresh, stale, empty position, error |
| Card (inline in chat) | Review and act | All card fields | Draft, adjusting, awaiting wallet, submitted, confirmed, failed |
| Guardian setup (sheet) | Configure and activate | All form fields, plain-language summary, fees before signing | Editing, invalid field, review, signing, active, failed |
| Guardian panel | Status and control | Status, limits, reserve and spendable amount, history with links, Pause, Deactivate, Withdraw | Inactive, active, paused, deactivated |
| Receipt detail | Proof | Transaction link, observed result, fees | Confirmed, failed |

Every screen: keyboard reachable, visible focus, reduced-motion respected, readable on a 360 px wide screen.

## Fees model

Structure decided (D12); pricing open.

| Fee | When | Charged how [I] | Disclosure |
| --- | --- | --- | --- |
| Guardian activation fee | At activation, per activation period | Flat amount transferred to the fee recipient in the activation transaction | Shown in the form and in the signed summary |
| Guardian action fee | Per executed automatic action | Flat, capped amount taken from the reserve, counted against the lifetime cap and never below the reserve floor | Shown in the form; each receipt shows the fee paid |
| Execution fee | Per manual action executed through Mr.Fund | Flat amount in the same signed batch, to the fee recipient | Shown on the card before Execute now |
| Managed placement fee (P1) | For monitored placements | Structure to be decided with P1 | Shown before approval |

Rules: no fee as a percentage of gross yield while ignoring borrowing cost [I, from S19 analysis]; any savings-linked fee must state its counterfactual and horizon; fee recipient account id is always shown. On testnet the demo charges test tokens and says so.

## Non-goals and scope cuts

**Non-goals (P0):** simulation game; evolving room; missions (D4); academy, courses or quizzes (D14); cross-chain execution (D13); leverage increase or new borrowing recommendations; multiple protocols; automated vault exits; trading; custody of user private keys; mobile apps.

**Ordered cuts if time runs short (cut from the top, the loop survives):**

1. F11, F10, F12, F9, F8 (all P1).
2. Third language in F1 tests (keep English plus one other).
3. Optional demo beat (accepted trigger) → keep only the rejected over-limit request, which proves the contract boundary.
4. F7 question set narrowed to questions 1 to 4 and 7.
5. If the founder picks D18 G2, or Gate 2 fails on the deployed Rhea contract: Guardian becomes a prepared transaction the user approves; automation and AI Security are not claimed. The founder decides before this cut (B1, B3).

The loop F1 → F2 → F3 → F4 → F5 and the Guardian rejection are never cut.

## Success and business essentials

- **Hackathon success:** the never-cut demo runs live against real dependencies; README lets a judge reproduce the read-only parts.
- **Product success measures [I]:** share of chats that end in a card; share of cards executed; Guardian activations; rejected-versus-accepted Guardian requests; post-action health change. No traction claims before real users exist.
- **Pricing hypothesis [I]:** flat Guardian subscription plus capped per-action fee, consistent with S19's recommendation. Numbers open (D12).
- **Operating costs [I]:** LLM inference per chat turn; watcher hosting; RPC (public endpoints first); contract storage staked in NEAR. Measured in Phase 4, not estimated here.
- **Distribution [U]:** Rhea community and NEAR DeFi channels; not verified.
- **Next 90 days [I]:** after the event, mainnet with tiny amounts if the demo ran on testnet, a second protocol, and an audit before any meaningful funds.

## Evaluation and evidence

Judging criteria are historical guidance; weights are UNVERIFIED [V, EVENT.md S2].

| Criterion | Artifact that proves it |
| --- | --- |
| Technical implementation | Guardian contract with negative tests; real transactions; engine test vectors |
| Design | Character states driven by data; card and receipt flow; multilingual chat |
| Impact | Repay-versus-yield answer that saves the user money in plain numbers |
| Originality | Honest comparison with DeFi Saver, BRACE, Hobba below |
| Sustainability | Disclosed fee model with recipient |

**Tracks (D15):** Unstoppable DeFi primary. AI Security only if contract-enforced limits are demonstrated (F6 rejection on-chain). Agent Economy only if F11 is real. Never Games.

**Submission requirements [V, EVENT.md]:** public repository and public X demo post (human-published) before 2026-11-14T23:59:00Z; aim for 2026-11-14T12:00Z. Testnet-only entries are eligible. A person may join at most two entries; each README names the other. **0xlann submits Mr.Fund; the repository is `github.com/0xlann/mr.fund` (D20).** Team list and any other entry of 0xlann: B9.

## Prior art and honest differentiation

| Product | What it already does | Source |
| --- | --- | --- |
| DeFi Saver | Automated liquidation protection: repays when a safety ratio is crossed | [V] help.defisaver.com, read 2026-11-02 (S15) |
| BRACE (Solana) | Reserve-funded, contract-capped Kamino debt guardian with caps, cooldown, live-state checks and post-repay invariants | [V, team claim] github.com/Pavlentiyys/brace-solana README, read 2026-11-02 (S31) |
| Hobba | Idle-collateral yield, risk-engine deleveraging and debt paydown | [V, team claim] hobba.io, read 2026-11-02 (S45) |

**Our delta [I]:** a character people actually understand, in their own language; an honest repay-versus-yield decision with real numbers; plain-language limits turned into a contract-enforced policy on NEAR; a card and receipt for every action. **We never claim the mechanism is new.**

## Risks and guarantees

**What Mr.Fund guarantees (when built and tested):**

- It never holds the user's private key.
- Manual actions happen only after the user signs them in their wallet.
- The Guardian contract (D18 G1) cannot spend more than the max per action, cannot go below the reserve floor, cannot exceed the lifetime cap, can only repay the one allowed debt token into Rhea, and stops automatic actions when the owner pauses or deactivates it; the owner can always withdraw the unlocked reserve.
- Every number shown comes from the engine and carries its inputs and data age. A visible position/card age label satisfies the data-age rule; chat states age only when a tool reports stale or missing data.

**What Mr.Fund does NOT guarantee (shown in product, F7 question 7):**

- It **reduces liquidation risk within limits you set**; it does not prevent liquidation. Fast price moves, stale oracle prices, an insufficient reserve, watcher downtime, network congestion or a failed transaction can all leave the position liquidated.
- Yield estimates are not returns; rates change continuously.
- No private keys does not mean no risk: the Guardian contract, Rhea and the wallet are smart-contract and software risk. The Guardian is unaudited hackathon code.
- What-if answers are scenarios, labelled as such.
- The AI can misunderstand a question; it cannot move funds by itself.

**Banned phrases in product, docs and pitch:** "never get liquidated", "guaranteed yield", "safe", "risk-free", "free borrowing".

**Risks (owners):**

| Risk | Owner | Mitigation |
| --- | --- | --- |
| Rhea testnet prices unusable (stablecoin feeds null on 2026-11-04) | Lead runs probes, founder decides | Phase 0 Gate 1 (P0.2); D19 ladder; B2 |
| Rhea cannot repay on behalf (confirmed in source) | Lead, founder decides | D18 G1 Guardian-held loan; Gate 2 proof on deployed code (P0.3); B1, B3 |
| Oracle freshness for the Guardian trigger | Lead | Phase 0 Gate 3 (P0.4); D27 fallback; B4 |
| LLM states an invented number | Lead | Tool-only numbers, output check (BUILD-PLAN P3.2) |
| Prompt injection triggers an action | Lead | LLM cannot build payloads; wallet or contract decides (ARCHITECTURE security model) |
| Watcher key leak | Lead | Function-call key limited to one method on the Guardian; contract enforces policy regardless |

## Sources and glossary

Sources (read dates as recorded; re-checked live before entering an interface contract):

- S14 Rhea contracts: https://guide.rhea.finance/developers/contracts.md (read 2026-11-02)
- S15 DeFi Saver liquidation protection: https://help.defisaver.com/automations/liquidation-protection (read 2026-11-02)
- S20 Rhea app snapshot via relay, about 2026-11-02 05:17 UTC; https://rhea.finance/
- S25 Rhea interest-rate model: https://guide.rhea.finance/x-chain-guides/lending-and-borrowing/how-lending-and-borrowing-works/interest-rate-model.md (read 2026-11-02)
- S26 Rhea liquidations: https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/how-lending-and-borrowing-works/liquidations (read 2026-11-02)
- S31 BRACE: https://github.com/Pavlentiyys/brace-solana (read 2026-11-02)
- S45 Hobba: https://hobba.io/ (read 2026-11-02)
- Event rules: https://nearhackathon.com/HACKATHON.md (read 2026-10-22)
- Live 2026-11-04 integration facts: [INTEGRATIONS](technical/INTEGRATIONS.md)

Glossary:

- **Health factor:** the protocol's ratio of risk-adjusted collateral to risk-adjusted debt, as a percentage; liquidation is possible below 100% on Rhea.
- **Liquidation:** a third party repays part of the debt and takes collateral at a discount.
- **Reserve:** money the user deposits into the Guardian for it to repay with.
- **Reserve floor:** part of the reserve the Guardian must never spend.
- **Trigger threshold:** health below which the watcher may request an action.
- **Watcher:** an off-chain service that reads the position and requests actions; it has no authority beyond what the contract allows.
- **Card:** a recommendation with Adjust and Execute now; after execution, the receipt.
- **Guardian account:** under D18 G1, a contract account created for one user, with no access keys, that holds the protected Rhea loan and the reserve; the user is its owner.
