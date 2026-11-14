## Why

The agent has deterministic tools and response guards but no provider loop or server endpoint (P3.4/P3.5). Live model suitability has not been evaluated.

## What Changes

- Build a bounded tool loop with guarded final text, cancellation and friendly provider failures.
- Expose a streaming Next.js Route Handler with input/rate limits and secret-free errors/logs.
- Add the 36-case multilingual evaluation dataset and offline harness; measure actual candidates only when B6 exists.
- Treat D25 model selection as measured evidence, never a historical catalog assumption.

## Capabilities

### New Capabilities

- `tool-driven-chat`: Bounded server orchestration and multilingual tool-grounded evaluation.

### Modified Capabilities

None; no baseline OpenSpec capabilities exist yet.

## Impact

packages/agent and apps/web/src/app/api/chat/route.ts (backend only). Full Guardian tool evaluation follows add-guardian-client-and-tools. No UI, signer, transcript database or account-authentication claim; live provider evaluation needs B6.
