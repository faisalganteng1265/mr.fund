## Context

The deployment owner executes this plan, not the build team. [I] This is a handoff design for hosted operation, not evidence of deployment or authorization to enable execution. All procedures and acceptance checks below are planned, not run by this change.

[V, repository inspection, 2026-11-13] D16 selected Next.js App Router/Route Handlers plus a separate Node watcher. OPEN-DECISIONS records G1 custody on 2026-11-07 and testnet selection on 2026-11-11. `apps/watcher/src/runtime/start.ts` hard-disables public submission with `submissionAllowed: () => false`. `operator:preflight` is read-only, and the single-use journal in `runtime/operator-journal.ts` is integrated only into the isolated sandbox operator, not the public runtime.

[U] Several older status paragraphs still call D18/D19 open (ARCHITECTURE, SMART-CONTRACT, INTEGRATIONS and `openspec/config.yaml`). The deployment owner must have the owning maintainers reconcile this contradiction before release; no network authorization or public-readiness claim is inferred from stale prose. Account creation evidence is not contract deployment evidence.

## Goals / Non-Goals

[I] Goals: reproducible web delivery; always-on, observable read-only watcher operation; environment/network isolation; persistent signing-history prerequisites for a separately reviewed future signer; owner-operated release and rollback checklists.

Non-goals: selecting a founder-owned host or budget, implementing journal recovery or enabling signing, changing fee/policy semantics, distributed watcher execution, deploying contracts, bypassing model acceptance, public posting or hackathon submission.

## Ownership and authorization

[I] `<deployment-owner>` owns configuration, release execution, secrets, evidence and rollback; `<founder>` owns infrastructure account/cost approvals and every mainnet deployment/transaction or real-fund spend; `<release-reviewer>` assesses evidence; `<watcher-owner>` handles watcher storage/reconciliation; `<on-call-owner>` receives alerts; `<model-owner>` resolves D25/P3.4. These placeholders must be replaced with named people before execution, not treated as granted authority.

[I] Existing testnet permissions apply only to their recorded accounts/tasks and operators. This plan grants no new account/login/deployment/transaction authority. Mainnet is read-only unless the founder explicitly authorizes each deployment or transaction, specifying network, account/contract, operation and funding cap. Approval for web hosting, testnet or an earlier transaction is not reusable mainnet authorization. The submitter remains 0xlann; deploying a URL is not an event submission.

## Deployment units and build contract

### Next.js frontend and Route Handlers

[I] Deploy `apps/web` and its workspace dependencies as one Next.js Node-compatible application, with the browser assets and `/api/chat` and `/api/position` on the same public HTTPS origin. A managed Next.js host is acceptable only if its Node Route Handlers satisfy streaming, deadlines, no-cache and edge-identity requirements; otherwise use a long-running Node web service behind the trusted edge. Do not export a static-only site, run the watcher inside a Route Handler, add a separate NestJS service or use an edge-only runtime for this cutover. [U] Provider, region, domain, plan and function limits remain owner decisions.

[I] Build from repository root so pnpm workspace links, source exports and the lockfile are present. Use the pinned `pnpm@12.14.0`, a recorded supported Node version satisfying root `engines` (currently `>=22.22.2`) and the pinned Next dependency. Planned commands:

```sh
pnpm install --frozen-lockfile
pnpm --filter @mrfund/web build
pnpm --filter @mrfund/web start --hostname 0.0.0.0 --port <host-assigned-port>
```

[I] The install/build must include required build tooling; follow existing lifecycle-script approvals, not blanket script enablement. Workspace packages ship TypeScript source; Next's existing `transpilePackages` handles them, so there is no extra package build pipeline. Retain the deployable Next output, static/public assets and needed dependencies/workspace source, not just an HTML export. Managed hosts may supply the equivalent Next start lifecycle. Record artifact/revision, Node/pnpm versions and public configuration fingerprint without secrets.

[I] Inject server values into the actual web process; starting Next in `apps/web` does not automatically load a root-local `.env` as a production secret store. Browser `NEXT_PUBLIC_*` values must exist at build time. A changed browser network/contract/auth configuration requires a new build, not just a server restart. Never reuse a testnet browser artifact against mainnet server configuration.

[I] The edge and host must pass SSE incrementally without buffering or response transformation, preserve abort/cancellation, and permit the chat's whole-request 30-second deadline plus transport overhead. Position's whole-request deadline is 15 seconds with 10-second downstream RPC limits. `/api/chat` and `/api/position` and their downstream reads remain no-store, with no CDN caching or stale-success response substitution. Observe terminal chat `done`/`error`; HTTP 200 alone is not model success. [U] Host timeout, streaming and cancellation behavior must be measured before release, not inferred from provider branding.

### Always-on Node watcher (D16/D29)

[I] Deploy `apps/watcher` as its own supervised Node service with workspace dependencies, pinned `tsx` runtime and mounted private key files. Existing command:

```sh
pnpm --filter @mrfund/watcher start <guardian-account-id>
```

[I] The Guardian id is a positional argument, not a new environment variable. Run exactly one active process per Guardian/key; disable autosleep, scale-to-zero and overlapping rolling replicas. Stop the old instance before starting its replacement. Signal shutdown invalidates unfinished pre-submission reads; an already signed/submitted request still requires reconciliation. The current runtime remains read-only even on a paid host with valid keys.

| Candidate | Recorded context, not a current quote | Deployment implication |
| --- | --- | --- |
| Railway Hobby | [V, D16/INTEGRATIONS pricing-page observation, 2026-11-04] Approximately USD 5/month | [I] Possible always-on Node service; verify volume, restart, region and total billing before approval |
| Fly.io | [V, same historical observation] Approximately USD 2.19 per 30 days for the cited compute | [I] Possible always-on Machine; disable autostop and verify persistent volume/compute total before approval |
| Render free | [V, D29 recorded behavior] Sleeps after 15 minutes without inbound traffic | [I] Unsuitable for the always-on watcher; keepalive traffic is not an approved substitute |

[U] D29/B8 host/account/cost authorization remains open. Storage, egress, backup, monitoring, taxes and current host pricing are not included in the historical compute figures. The founder approves the current complete cost, not this table.

## Environment matrix (names only)

[I] Every name below comes from root `.env.example`; this change adds none. Values are intentionally omitted. Public configuration is not a secret. Only the explicitly browser-prefixed names belong in browser build configuration; other public values remain server/process configuration. Do not copy the entire environment to both services.

| Names | Placement / timing | Classification and boundary |
| --- | --- | --- |
| `NEXT_PUBLIC_NEAR_NETWORK_ID`, `NEXT_PUBLIC_NEAR_RPC_URL` | Web build time | Public browser network/RPC; must agree with server network and the intended chain |
| `NEXT_PUBLIC_RHEA_LENDING_ID`, `NEXT_PUBLIC_FEE_RECIPIENT_ID` | Web build time | Public browser verifier copies; equal server counterparts; missing/mismatch blocks Execute |
| `NEXT_PUBLIC_GUARDIAN_FACTORY_ID`, `NEXT_PUBLIC_GUARDIAN_ACTION_FEE_ATOMIC` | Web build time | Public Guardian setup inputs; factory matches server/template, action fee matches the approved debt-token policy; missing inputs block setup |
| `NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID` | Web build time | Public Auth application id, never a client secret; verify approved origin/network; mainnet Auth disabled without an approved id |
| `NEAR_NETWORK_ID`, `NEAR_RPC_URL` | Web server and watcher runtime | Public network/credential-free HTTPS RPC; validate fresh chain identity, not only URL or suffix |
| `RHEA_LENDING_ID` | Web server runtime; contract deployment manifest | Public network-specific lending target; watcher cross-checks observed Guardian config, not an invented env override |
| `GUARDIAN_FACTORY_ID` | Web server runtime; contract deployment manifest | Public factory identity; a created account alone does not prove initialized/deployed template |
| `FEE_RECIPIENT_ID`, `FEE_TOKEN_ID`, `FEE_ACTIVATION_ATOMIC`, `FEE_ACTION_ATOMIC`, `FEE_EXECUTION_ATOMIC` | Web server runtime; approved fee/template manifest | Public pricing; canonical integer token atomic amounts, explicit zero only when decided; missing values do not mean zero |
| `NEARAI_BASE_URL`, `NEARAI_MODEL` | Web server runtime only | Non-secret provider config; official supported gateway only; model choice does not pass acceptance |
| `MAX_DATA_AGE_MS` | Web server runtime | Non-secret freshness configuration; retain existing engine/route semantics; never raise freshness limits to make a check pass |
| `NEARAI_API_KEY` | Web server secret store/runtime only | Server secret; never watcher, browser, image layer, build log or artifact |
| `CHAT_PROXY_SECRET` | Trusted edge and web server secret stores/runtime only | Shared server/edge secret; never browser or watcher |
| `CHAT_PROXY_SECRET_HEADER`, `CHAT_PROXY_IP_HEADER` | Trusted edge and web server runtime only | Non-secret header-name configuration; all three proxy settings form one contract |
| `WATCHER_ACCOUNT_ID` | Watcher runtime; approved factory/template manifest | Public requester account; not a Guardian id or owner identity |
| `WATCHER_KEYS_DIR` | Watcher runtime only | Sensitive mount path for per-Guardian function-call key files; file contents are watcher secrets, not environment values or web secrets |

[I] Watcher CLI currently consumes only `NEAR_NETWORK_ID`, `NEAR_RPC_URL`, `WATCHER_ACCOUNT_ID`, `WATCHER_KEYS_DIR` plus the Guardian argument. A signing-journal directory is a future integration/deployment input, not a supported public-runtime environment variable. Do not invent a `NEXT_PUBLIC_*` secret, journal variable or signing-enable flag in the deployment dashboard.

## Per-network release manifest

[I] Keep separate testnet and mainnet manifests/secret namespaces, artifacts and journal volumes. Record network; RPC endpoint and freshly observed chain id; browser/server config agreement; lending version/code provenance; oracle; debt/collateral token ids and decimals/extra decimals; factory id/code hash/template; owner/demo, watcher, fee recipient and Guardian ids; Guardian config/policy/status; scoped public key/receiver/method/allowance; fee recipient registration; artifact revision; approvals and evidence times. Store public identities/evidence only, never key values. Implicit ids alone cannot identify a network.

| Item | Testnet | Mainnet |
| --- | --- | --- |
| Lending | [V, INTEGRATIONS historical views] `contract.1689937928.burrow.testnet`, version `0.11.0` | [V, historical views] `contract.main.burrow.near`, version `0.16.2` |
| RPC candidate | [V, recorded read endpoint] `https://test.rpc.fastnear.com` | [V, recorded read endpoint] `https://free.rpc.fastnear.com` |
| Oracle | [V, recorded config] `pyth-oracle.testnet` | [V, recorded config] `aggregate-oracle.near` |
| Recorded accounts | [V, account creation 2026-11-11] Factory account `f-mrf-b1ce96af6a.testnet`; watcher `w-mrf-b1ce96af6a.testnet`; demo owner `d-mrf-b1ce96af6a.testnet`; fee recipient `fee-mrf-b1ce96af6a.testnet` | [U] Approved factory, watcher, owner, recipient and Guardian identities |
| Release evidence | [U] Factory deployment/template, actual Guardian ids, scoped keys and complete public loop must be re-established from final chain views | [U] Deployment, funding, fees and all write authorizations; read-only historical views authorize none |

[I] The recorded testnet watcher has only a full-access key in the cited evidence; never mount it as the watcher signing key. Verify fresh access-key permissions at finality `final`: one Guardian receiver, method list exactly `request_repay`, finite allowance and zero attached deposit. Unknown lending versions refuse instead of switching payloads or networks. Fixed-price assets retain fixed-source disclosure; replay/price-driven scenario evidence is labelled **Simulated**. Historical RPC/account facts are not current balances, provider quotas or permission to transact.

## Edge identity and rate limits

[I] Configure `CHAT_PROXY_SECRET`, `CHAT_PROXY_SECRET_HEADER` and `CHAT_PROXY_IP_HEADER` together only behind a trusted edge. The edge strips client-supplied copies of both configured headers, overwrites them with its secret and one authoritative validated client IP, and prevents direct public access to the origin (including preview/alternate hostnames). Never trust raw `X-Forwarded-For`, a user-supplied secret header or an account selector as authentication. Partial configuration is not an approved deployment.

[V, CHAT-API/INTEGRATIONS local contract] Chat limits are 10 requests per 60 seconds per transport identity and separately per claimed account, with at most 4,096 local buckets. Position limits are 30 requests per 60 seconds per transport identity and separately per network/account, with 4,096 combined local buckets and conservative `Retry-After: 60`. Without trusted-edge identity, direct clients share the conservative `direct-client` bucket. Neither route's buckets coordinate across processes or survive process replacement; active buckets are not evicted to manufacture quota.

[I] A single web process behind a correctly authenticated edge can retain the documented local boundary. Managed/serverless replicas, autoscaling and overlapping releases require an edge-enforced aggregate quota; do not advertise local counters as global abuse protection. [U] Provider edge-quota mechanism/budget and client-IP canonicalization must be demonstrated by the deployment owner. If unavailable, do not open an unbounded public model endpoint; an internally restricted read-only rehearsal does not satisfy public release acceptance.

## Persistent signing journal and public gate

[I] This release may host the existing watcher read-only. It MUST NOT patch `submissionAllowed`, pass an override, wrap the signer to evade the gate, invoke the sandbox CLI against a public network, use a full-access key, or equate a clean nonce with restart certainty. Public automatic submission requires a separately implemented/reviewed runtime, public settlement/D27 evidence, D18/D19/B7 permissions, scoped keys and independently reconciled history. Host provisioning and this plan do not deliver that runtime.

[I] Before any later signing-capable release, `<watcher-owner>` must provide a private persistent volume, separate from ephemeral container/image/tmp storage and the read-only key mount. All invocations for the same network/Guardian must use the same durable signing-history namespace across restarts, replacements and rollback. The existing journal hashes network/Guardian into the filename and exclusively creates a mode-0600 record, syncs intent plus directory before signing, and syncs the hash before broadcast. A present, partial or unreadable record blocks another attempt. It is a single-use write-ahead barrier, not a recoverable queue; no automatic deletion, replay or reset exists. A fresh volume does not prove that the key never signed before.

[I] Reconciliation must establish final transaction receipts and resulting Guardian status/history/reserve/debt, correlate known hashes, and preserve unresolved intents as read-only locks. Nonce advancement, process exit, top-level receipt success or a missing transaction lookup alone cannot clear uncertainty. No blind re-sign/rebroadcast after timeout. An existing settled record still blocks the current barrier: repeated public operation needs a separately reviewed recovery/archive workflow, not manual unlinking to unlock it. [U] Public integration, crash/restart recovery protocol and its operator approval are missing prerequisites, so no repeated-signing or restart-safe production claim is made.

[I] Back up signing history securely with recorded snapshot time; exclude key material from journal/log backups. Restore onto the same namespace with exactly one stopped-then-restarted process. A stale/lost snapshot or missing volume cannot demonstrate complete history and leaves signing disabled pending independent reconciliation. Disk-full, unavailable mounts, partial writes, duplicate processes, crashes around signing/hash-sync/broadcast and restore/rollback are required negative cases for that future integration.

### Money-path review boundary

[I] Permission boundary: manual money movement remains a user-wallet approval; the server/LLM holds no signer; a future watcher can call only its Guardian's `request_repay` with zero deposit via a constrained function-call key. Guardian I1-I8 enforce reserve/amount/cap/target/caller/cooldown/paused-state/accounting, I9 preserves owner withdrawal and I10 requires keyless, non-upgradeable Guardians. Operational W1 is at most one unresolved request per Guardian without owner authority.

[I] Negative evidence before enabling any future public flow must include wrong-chain/full-access/wrong-receiver/wrong-method key refusal, over-limit rejection with unchanged state, paused/stale/cooldown refusal, ambiguous broadcast/restart lock, duplicate-process exclusion, and journal failure before any new signature/broadcast. This plan does not guarantee uptime, liquidation prevention, loss prevention, an audit or that an observed debt change was caused by a particular transaction.

## Heartbeat, monitoring and secret rotation

[I] Collect existing structured stdout heartbeat, not a fabricated HTTP health endpoint: `observedAt`, `startedAt`, `intervalMs`, and per-Guardian `network`, `requests`, `monitoring`, `lastSuccessfulReadAt`, `lastEvaluationAt`, pending state/hash, read-failure/backoff state and error flag. Keep mode visible: fresh reads plus `read_only` do not mean automatic protection is enabled. Do not claim the UI consumes this source; its heartbeat connection remains unverified/unavailable until actually integrated.

[I] `<on-call-owner>` configures an external log-age alert when heartbeat or successful-read/evaluation age exceeds two 30-second polling intervals (60 seconds), distinguishing stale monitoring, read-only submission mode and unresolved requests. Alert separately on startup failure, repeated read failures, restart loops, disk/volume failure, exhausted key allowance, stale/missing prices and prolonged pending state; do not change the watcher's backoff or signing gate to silence alerts. [U] Alert destination, pending-age escalation threshold, retention and uptime expectations require named-owner approval.

[I] Monitor the public web origin for TLS/availability, position typed failures and provenance age, chat terminal errors/fallbacks/deadlines, admission rejection and provider spend/quota. Provider outage must leave position reads usable without the model credential; do not substitute fixture data as live. Logs/evidence omit transcripts, private keys, bearer/proxy secrets, sensitive paths and raw provider/RPC errors. Evidence includes revision, public network/ids, timestamps, observed terminal outcomes and approval references.

[I] Rotate the provider key through the secret store; restart the web server, observe approved read-only inference, then revoke the old credential. Rotate the proxy secret as a coordinated edge/server cutover with origin blocked throughout; verify forged-header refusal afterward, never temporarily trust forwarded IPs. Compromise calls for prompt revocation and temporary endpoint restriction rather than waiting for a healthy replacement.

[I] Watcher key rotation: stop the process, preserve/reconcile journal and pending hashes, obtain account-owner authorization to revoke/add a finite-allowance per-Guardian function-call key, install it only in the private watcher mount, and re-verify fresh chain identity/final permission. Changing `watcher_id` requires the Guardian owner's signed `rotate_watcher`; changing factory defaults does not change existing Guardians. Mainnet add/delete-key or rotate transactions each require explicit founder authorization. Never grant full access, attach owner keys or discard old history to escape an unresolved request. Rotation does not open the hard-disabled gate.

## Pre-deployment checklist

All items are [I] planned acceptance steps; unchecked means no evidence is claimed.

- [ ] Name owners, record the intended read-only or future separately authorized mode, reconcile stale decision statuses, and obtain host/account/cost approval. Mainnet writes each have explicit founder approval and funding caps.
- [ ] Resolve D25/P3.4 before publicly exposing model chat; retain a restricted rehearsal until evidence passes. Confirm relevant public contract/settlement/permission gates separately; do not mark the whole product ready from a web build.
- [ ] Record reviewed revision/artifact, existing required local/security/fresh-clone evidence (P6.1/P6.2), pinned toolchain and rollback artifact. Deployment owner runs/records acceptance; this docs change runs none.
- [ ] Complete per-network manifest from final reads; verify RPC chain, lending version, factory/template/code, Guardian identity/policy, token units, fees/registration and browser/server matching configuration.
- [ ] Install secrets in isolated stores/mounts; confirm no provider/watcher credentials in public artifacts or logs, no broad watcher key and no signing override. For any future signer prove durable volume/reconciliation; otherwise stay read-only.
- [ ] Confirm Node host/build/start, incremental SSE, full deadlines/cancellation/no-store, private origin plus overwritten edge headers, aggregate quotas where replicated, and no watcher autosleep/overlap.
- [ ] Configure external heartbeat/web/provider monitoring, on-call contact, secret-rotation and rollback access; approve current cost including volumes/backups.

## Post-deployment checklist

All items are [I] planned observations, not performed checks.

- [ ] Confirm HTTPS origin serves the expected artifact and network; no alternate public origin bypasses the edge. Wrong network/config fails closed, not with simulated success.
- [ ] Observe GET and POST `/api/position` for an approved public account, provenance/time/no-store and missing/stale-data behavior. Repeat with model credentials absent to establish independence.
- [ ] After model acceptance and inference authorization, observe `/api/chat` incremental SSE, terminal success/error, deadline/cancellation and no-cache; no raw candidate tokens, secret leakage or auto-execution. Test malformed/oversized/unsupported requests with sanitized failure states.
- [ ] Exercise forged proxy/IP headers, direct-origin attempts and route admission across the actual topology; record aggregate quota behavior for replicas and recovery after limits.
- [ ] Observe at least three consecutive 30-second watcher intervals with fresh read/evaluation timestamps and explicit read-only requests mode; stop reads/process and observe the 60-second stale-monitoring alert/recovery. No transaction is expected from the current public entry.
- [ ] Rehearse watcher stop-before-start replacement and restore/rollback without clearing signing history or enabling the gate. Any future signer acceptance requires separately authorized crash/restart/volume-loss and public terminal-outcome evidence.
- [ ] Record timestamped deployment URL, revision, public configuration/chain evidence, mode, limits, remaining blockers, rollback rehearsal and reviewer approval. No explorer receipt or protection-enabled claim without an observed corresponding outcome.

## Rollback and incident handling

[I] Restrict affected public endpoints/traffic first if identity, secrets, numerical truth or abuse controls are uncertain. Restore the last reviewed web artifact together with its matching browser/server network, contract and fee configuration; do not roll back just runtime values behind an incompatible compiled browser bundle. Preserve no-store behavior and revoke exposed credentials. Observe position provenance and approved chat terminal behavior again before reopening traffic.

[I] For the watcher, stop the active process, preserve key/journal mounts and pending hashes, and restart the last reviewed compatible artifact only in read-only mode until independent reconciliation is complete. Never start a second replica, delete/truncate journal records, restore an older history as proof of completeness, retransmit an uncertain request or widen a key. A lost volume keeps signing blocked. If needed, the Guardian owner may separately sign pause/deactivate or rotate the watcher under the applicable authorization; stopping the service alone does not cancel a transaction already submitted.

[I] Web/watcher rollback cannot reverse settled transactions, refund fees, repay debt or upgrade an existing Guardian. I10 forbids Guardian upgrades and keys; contract replacement requires a newly reviewed factory/Guardian path and owner-controlled migration, with fresh authorization for every mainnet money-moving step. Report the observed state and residual downtime/liquidation risk, not a restored-protection claim based only on process health.

## Sources and unresolved release inputs

[V, inspected 2026-11-13] Basis: `.env.example`; root and app package manifests; `apps/web/next.config.ts`; watcher `runtime/start.ts`, `operator-journal.ts`, `signer-port.ts`, `log.ts`; OPEN-DECISIONS D16/D18/D19/D25/D29; BUILD-PLAN P3.4/P5.3/P5.4/P6; ARCHITECTURE deployment/permission model; SMART-CONTRACT I1-I10; INTEGRATIONS public position/config/runtime/account/host sections; CHAT-API; WATCHER-SANDBOX; LESSONS on watcher stop/restart/SDK behavior. Historical facts retain their original dates; source presence is not exercised deployment evidence.

[U] Release blockers: named deployment/on-call owners; decision-status reconciliation; web provider/domain/limits; D29/B8 complete cost approval and durable-volume behavior; aggregate edge quota/identity mechanism; D25/P3.4 passing reviewed model evidence; fresh public contract/template/scoped-key/settlement/D27 evidence; future public journal integration/recovery; heartbeat consumer and alert delivery evidence. Mainnet contract/account/fee choices and every mainnet write approval remain unprovided. None is silently chosen or marked complete here.
