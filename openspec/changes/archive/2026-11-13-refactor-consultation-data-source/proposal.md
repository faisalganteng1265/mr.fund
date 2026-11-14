## Why

`/play` is the product's only screen, and `apps/web/src/play/Playground.tsx` is one 2,345-line file whose single `Playground()` component (lines 235–2345) owns every piece of state: the simulated debt, wallet balance, wallet outcome switch, Guardian status, reserve, receipts and scripted chat replies. Four coming changes (live login, live chat and position, wallet repay, live Guardian) must each replace a slice of that state. Without a seam they would all edit the same 2,100-line function, collide, and make it impossible to show which numbers are live and which are simulated, a rule in CLAUDE.md ("Fixture data never appears as live").

This change adds the seam first, with no behavior change, so later changes are small, independent and reviewable. It touches BUILD-PLAN P4.4 only; it completes no feature.

## What Changes

- Define a capability-based `ConsultationSource` in `apps/web/src/play/source/`: `session`, `position`, `chat`, `execution` and `guardian` ports. Each port declares `provenance: "simulated" | "live"` so the UI can label every surface independently.
- Move the current in-memory behavior (fixture position, scripted replies, mock wallet outcomes, simulated Guardian, receipts) into a `demoSource` that implements those ports without changing a single visible string or number.
- Extract `useConsultation(source)` and split `Playground.tsx` into composition plus focused components (wallet dialog, chat, position, Guardian, activity, receipt). Extraction happens one component per commit.
- Keep `apps/web/test/playground.test.ts` (16 interaction tests) unchanged as the regression harness; add tests only for gaps the extraction exposes.
- No dependency, route, environment variable or visual change.

## Capabilities

### New Capabilities

- `consultation-source`: Provenance-labelled data ports behind the consultation UI, with a demo implementation equal to today's behavior.

### Modified Capabilities

None. No archived spec describes the playground.

## Impact

`apps/web/src/play/` only (plus new `apps/web/src/play/source/` and extracted components) and `apps/web/test/` additions. No server, package, contract or watcher change. Downstream: `add-live-wallet-session-ui`, `connect-consultation-to-live-chat`, `add-wallet-manual-repay-execution`, `add-guardian-live-activation-ui` implement ports against this seam. No network access, wallet, signing or authorization is introduced; D19 and B7 are not needed.
