## Why

[V, repository inspection, 2026-11-09] `apps/web/src/app/api/chat/route.ts` obtains public Rhea snapshots through `createContextLoader`; `get_position` in `packages/agent/src/tools.ts` derives facts with the engine. There is no independent position Route Handler in the supplied change scaffold. A position panel and post-repay refresh must work without LLM availability (PRD F2; BUILD-PLAN P3.1 Tool registry and dispatcher, P4.3 Wallet and receipts).

## What Changes

- [I, proposed] Add read-only GET and POST `/api/position`, sharing the chat snapshot acquisition and engine calculations rather than introducing another protocol reader.
- Return exact integer-string lending balances, conservatively rounded debt and health, liquidation prices, input assumptions, timestamps, network/source identity and `provenance: "live"`.
- Validate public account/network selectors, bound requests and RPC work, and expose stable sanitized errors for invalid input, absent positions, unsupported versions, unavailable networks and stale/untrusted data.
- Keep fixtures exclusively in injected local tests. The production route never signs, submits transactions, calls the model or manufactures a position.

## Capabilities

### New Capabilities

- `position-read-api`: A bounded, network-qualified public position view independent of chat inference.

### Modified Capabilities

None. P1.1 units, P1.2 health/liquidation and P1.4 snapshot acquisition remain the numerical/read foundations; P3.1 consumes the same foundations. This does not complete P4.3 wallet signing or P4.5 public repayment.

## Impact

[I] Owning implementation paths: a new `apps/web/src/app/api/position/route.ts` and focused server handler/tests; extraction of reusable read/configuration boundaries from `apps/web/src/server/chat/context.ts` and transport/admission helpers where shared; existing `packages/engine`, `packages/rhea` and `packages/shared` functions are reused. No UI, wallet authority, contracts, signer, provider dependency or database is added.

External gates stay explicit: D19 is founder-owned and open; configuring a read-only network does not decide the demo network. B7 is not needed for public reads and must not be bypassed by account creation. [U] A currently usable public testnet position with fresh prices is not established; INTEGRATIONS records null testnet prices. The historical public mainnet read in P1.4 does not prove a current position or UI parity. Live smoke requires an existing public position, remains separate from local tests and does not tick P1.2/P1.4 parity, P3.1's remaining tools or P4.3's wallet acceptance.
