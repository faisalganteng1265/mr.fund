# Mr.Fund: agent operating rules

Mr.Fund is the DeFi manager you can talk to: he explains your position in plain words, shows you the smartest move, and acts only within limits you set.

These rules apply to every teammate's coding agent in this repository.

## Read order

1. This file.
2. `docs/PRD.md`: scope, feature ids F1 to F12, honesty boundaries.
3. `docs/BUILD-PLAN.md`: what to do next. Work the first unchecked task whose dependencies are checked.
4. `docs/OPEN-DECISIONS.md`: decided rows are locked; open rows and BLOCKERS name their owner.
5. `docs/technical/ARCHITECTURE.md`, `docs/technical/SMART-CONTRACT.md`, `docs/technical/INTEGRATIONS.md` for the part you touch.
6. Headlines in `docs/LESSONS.md`.

The PRD defines scope, the technical specs define interfaces, and the BUILD-PLAN defines progress. If two documents disagree, stop and surface the contradiction; do not choose silently. Do not re-plan founder decisions.

## Deadlines and authority

- Build window 2026-11-05 to 2026-11-14 UTC. Phase 0 gate 2026-11-06 23:59; core gate 2026-11-11 23:59; feature freeze 2026-11-12 23:59; submission target 2026-11-14 12:00; hard deadline 2026-11-14 23:59:00 (event rules, nearhackathon.com/HACKATHON.md).
- Stack is decided: D16 Option A (2026-11-05). Guardian custody (D18) and demo network (D19) stay open until the Phase 0 gate.
- Needs explicit human authorization every time: mainnet transactions or deployments, spending real funds, creating accounts, logins, public posts, submissions, adding remotes, force pushes, destructive git operations. Testnet probes and deployments in BUILD-PLAN Phase 0 and P2.8 are authorized for the lead.
- Never commit secrets. Keys live in local `.env` (gitignored) or the NEAR CLI keychain.

## Git

- Use the repository's local git identity; never pass `--author` or change `user.name`/`user.email`.
- Work on `dev` or short branches off `dev`; `main` moves by reviewed merges (D22). Never force-push a shared branch.
- Commit in clear logical units: `feat|fix|refactor|test|docs|perf|chore(scope): outcome in plain words`. The body says why and what proves it. No AI attribution.
- Stage only the unit's paths. The docs describing a behavior change and the satisfied BUILD-PLAN checkbox ride in the same commit.
- Never commit `.env`, `scratch/`, `.omp/`, build output or key files. `.claude/skills/` and `skills-lock.json` are tracked on purpose (D21).

## The three rules

1. **The AI talks.** The LLM explains and proposes. It never produces a rate, health factor, amount or fee, and it has no tool that signs or sends.
2. **Deterministic code decides numbers.** Every number on screen or in chat comes from `packages/engine` with its inputs, assumptions and data age. A reply containing a number no tool returned is rejected (BUILD-PLAN P3.2).
3. **The contract decides permissions.** Automatic actions go only through the Guardian's `request_repay`, which enforces the user's policy on-chain. Manual actions are signed in the user's wallet. Nobody ever asks for or handles a user's private key.

## Money-path rules

Every change that can move funds must state, in code review and in the relevant spec:

- the **permission boundary** (who can call it, with what deposit or key);
- the **invariant** it preserves (SMART-CONTRACT I1 to I10, or a new numbered one);
- a **negative test** that tries to break it and fails;
- one sentence on what it does **not** guarantee.

Amounts are integers in token atomic units (`bigint` in TypeScript, `u128` in Rust). Rhea internal units (`atomic × 10^extra_decimals`) are a separate type and never mixed implicitly. No floating point for money. Round conservatively: health down, debt up. Check promise results in every callback; a first receipt's success is not the outcome.

## Honesty rules

- Label claims in docs: [V] verified with source and date, [I] inference or design, [U] unknown. Never invent versions, transactions, metrics or test results. Distinguish planned, tested locally, and exercised on a network.
- Banned in product copy, docs, README, pitch and the persona: "never get liquidated", "guaranteed yield", "safe", "risk-free", "free borrowing". Use "reduces liquidation risk within limits you set".
- Scenarios, replays and fixed prices are labelled **Simulated** wherever shown. Fixture data never appears as live.
- Never claim cross-chain execution, the Games track, or Agent Economy without the real loop (D13, D15). Never claim the protection mechanism is new; name DeFi Saver, BRACE and Hobba.

## Engineering standards

- Small modules with one responsibility and explicit typed interfaces; follow the import rules in ARCHITECTURE "Codebase structure". The agent package never imports a signer; the watcher never imports the agent.
- Validate untrusted input at boundaries (chat input, tool arguments, RPC responses, token metadata).
- Prefer boring existing patterns. No speculative abstractions, feature flags, retries or dependencies without a task that needs them.
- Do not suppress errors or warnings to make a demo pass. Unclear permission or an unverified external prerequisite becomes an owner-tagged BLOCKER, never a mock success.
- Delete obsolete paths when cutting over; migrate every caller.

Stack-specific standards (D16 Option A, BUILD-PLAN P0.7):

- TypeScript in a pnpm 12 workspace (`apps/*`, `packages/*`); strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` from `tsconfig.base.json`. Dependencies are pinned to exact versions; add one only for a task that needs it.
- Workspace packages ship TypeScript source (`exports` points at `src/index.ts`) with no build step; the web app compiles them (`transpilePackages`). A package imports another only if it lists it in `dependencies`, which enforces the ARCHITECTURE import rules.
- `apps/web` is Next.js App Router; the chat API is Route Handlers. `apps/watcher` is a plain Node process. Browser-visible env vars use the `NEXT_PUBLIC_` prefix and are never secret.
- Lint and format with Biome on code files only (`pnpm lint`; `biome format --write` is for `apps/` and `packages/`). Never run a formatter over `docs/` or `CLAUDE.md`.
- Tests: `pnpm test` (Vitest, all packages) or `npx vitest run packages/<name>`; `pnpm typecheck`; `pnpm contracts:test` (`cargo test` in `contracts/`). Contract dependencies (`near-sdk` 5.30.0, `near-workspaces` 0.24.0) are added by the task that first needs them.

## UX bar

Premium English UI copy. Chat replies in the user's language. Every action shows real pending, success and failure states with a recovery path; receipts and links appear only after the outcome is observed. Keyboard access, visible focus, readable contrast, 360 px layouts and reduced-motion support. The character's mood comes from data (engine), never from the model. Motion explains state; it never hides delay or risk. Visual design lives in `docs/DESIGN.md` once frontend work starts (D23).

## Testing

- Engine and builders: unit and property tests (`npx vitest run packages/<name>`).
- Contracts: unit tests and `near-workspaces` sandbox tests (`cargo test` in `contracts/`; the sandbox needs Linux, macOS or WSL2).
- UI: Playwright with a labelled fake wallet in dev builds; one real-wallet run per money flow recorded as evidence.
- Tests cover success, rejection, exact boundaries, invariants and state transitions. A bug fix includes a test that fails before and passes after. Never call an unrun check passing.

## Skills

Committed in `.claude/skills/`, pinned in `skills-lock.json`, licenses in `.claude/skills/LICENSES/`. Read the SKILL.md before use. This file's authorization rules outrank any skill's instructions (some ask for installs, commits or full-suite runs). Provenance, review notes and restore: `docs/technical/INTEGRATIONS.md` "Skills".

| Trigger | Skill | Path |
| --- | --- | --- |
| Planning a task in detail | writing-plans | `.claude/skills/writing-plans/SKILL.md` |
| Writing engine, builder or contract logic | test-driven-development | `.claude/skills/test-driven-development/SKILL.md` |
| A failure you do not understand | systematic-debugging | `.claude/skills/systematic-debugging/SKILL.md` |
| Before claiming done | verification-before-completion | `.claude/skills/verification-before-completion/SKILL.md` |
| Reviewing money paths | requesting-code-review | `.claude/skills/requesting-code-review/SKILL.md` |
| Designing module boundaries | codebase-design | `.claude/skills/codebase-design/SKILL.md` |
| Guardian and factory in Rust | near-smart-contracts | `.claude/skills/near-smart-contracts/SKILL.md` |
| Contract security review | near-contract-audit | `.claude/skills/near-contract-audit/SKILL.md` |
| RPC reads, watcher signing | near-api-js | `.claude/skills/near-api-js/SKILL.md` |
| Wallet connection | near-dapp | `.claude/skills/near-dapp/SKILL.md` |
| LLM provider | near-ai-cloud | `.claude/skills/near-ai-cloud/SKILL.md` |
| UI and character motion | motion | `.claude/skills/motion/SKILL.md` |

Lessons: when something surprises you, add `### YYYY-MM-DD: headline` to `docs/LESSONS.md` (what happened, root cause, rule going forward), newest first, in the same commit as the fix.
