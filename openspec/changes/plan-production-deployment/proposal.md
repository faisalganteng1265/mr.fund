## Why

The deployment owner executes this plan, not the build team. [I] This change specifies the operational handoff for a production-hosted Mr.Fund web app and separate watcher; it does not provision infrastructure, authorize spending, enable public signing or assert production readiness.

[V, repository inspection, 2026-11-13] D16 selects Next.js App Router/Route Handlers and a separate always-on Node watcher. `/api/chat` and `/api/position` exist, but model acceptance remains gated in D25/P3.4. The public watcher explicitly sets `submissionAllowed: () => false`; its optional single-use signing journal is not integrated into public operation. Hosting alone cannot complete these gates.

## What Changes

- Define web host/build/start requirements, streaming and no-cache behavior, and the always-on watcher host/storage boundary.
- Provide a names-only environment matrix from `.env.example`, build-time browser configuration, secret separation and per-network identity records.
- Require persistent signing-journal storage and reviewed reconciliation before any future public signing, without bypassing the current hard-disabled gate.
- Define trusted-edge `CHAT_PROXY_*` handling, per-process admission limits, monitoring, key rotation, pre/post-deployment evidence and rollback.
- Assign all execution tasks to owner placeholders, with explicit founder authorization for every mainnet deployment/transaction and real-fund expenditure.

## Capabilities

### New Capabilities

- `production-deployment`: Owner-operated deployment, configuration isolation, fail-closed operational gates and evidence-based release/rollback.

### Modified Capabilities

None. This plan does not amend the Guardian, watcher or API contracts or enable their deferred behavior.

## Impact

[I] Artifacts only under `openspec/changes/plan-production-deployment/`. Execution consumes BUILD-PLAN P3.4, P5.3/P5.4 and P6.1/P6.2/P6.4/P6.5 evidence without checking those tasks here. D29/B8 host/account/cost approval, public settlement/D27 feasibility and restart-safe signing remain separate gates. D19's dated row selects testnet; "production" describes hosting, not permission to use mainnet.

## Non-goals

No application/contract implementation, host procurement, account creation, login, deployment, money movement, public post or event submission. No new environment names, database, distributed signer, autoscaling watcher or change to product/design scope.

## Uncertainties

[U] Web provider/domain/runtime plan and D29 watcher host, current pricing including persistent volumes, model acceptance, public contract deployment and scoped-key evidence, journal recovery integration, and alert ownership remain unresolved. [U] Older D18/D19 status statements in ARCHITECTURE, SMART-CONTRACT, INTEGRATIONS and OpenSpec configuration contradict dated decision rows; their owners must reconcile them before release. This plan records the contradiction rather than silently changing founder decisions.
