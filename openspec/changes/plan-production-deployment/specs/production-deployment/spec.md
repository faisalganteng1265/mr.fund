## ADDED Requirements

### Requirement: Deployment ownership and authorization

The deployment owner SHALL execute the deployment plan, not the build team. The release record SHALL name deployment, founder approval, watcher, model, review and on-call owners before execution. This plan MUST NOT be interpreted as authorization to create accounts, log in, purchase hosting, deploy contracts, move funds, publish or submit the project. Every mainnet deployment/transaction and real-fund expenditure MUST have explicit founder authorization for that operation, network, target and funding cap.

#### Scenario: Hosting approval is not mainnet approval

- **WHEN** the founder approves a web/watcher host or a testnet action
- **THEN** the deployment owner MUST NOT infer permission for any mainnet deployment, account/key operation or transaction
- **AND** the release remains on its authorized network/mode until separate authorization exists

#### Scenario: Conflicting historical status prose

- **WHEN** older D18/D19 descriptions contradict dated decision rows
- **THEN** the release record SHALL identify the contradiction and require owning-maintainer reconciliation before release
- **AND** dated G1/testnet decisions MUST NOT be presented as public-loop evidence or mainnet authorization

### Requirement: Reproducible Next.js web hosting

The deployment SHALL serve the Next.js frontend, `/api/chat` and `/api/position` as one Node-compatible application on a public HTTPS origin. The deployment owner SHALL record the reviewed revision, artifact, pinned package manager, supported Node version, root-workspace frozen-lockfile installation and web build/start lifecycle. Workspace source packages and required static/runtime assets SHALL be included. A static export or an edge-only runtime MUST NOT replace the existing Route Handlers.

#### Scenario: Workspace build

- **WHEN** the owner builds a release from the repository root
- **THEN** the owner SHALL use `pnpm install --frozen-lockfile` and `pnpm --filter @mrfund/web build`, or an explicitly recorded equivalent managed-host lifecycle
- **AND** a self-hosted service SHALL run `pnpm --filter @mrfund/web start` with the host's approved bind address/port and runtime configuration
- **AND** no separate workspace-package build pipeline or watcher inside the web process SHALL be introduced

#### Scenario: Browser configuration changes

- **WHEN** a browser network, RPC, contract, fee or Auth setting changes
- **THEN** a newly built artifact SHALL contain the intended `NEXT_PUBLIC_*` configuration
- **AND** a server-only restart MUST NOT be treated as updating an already compiled browser bundle

### Requirement: API transport fidelity

The web host and edge SHALL preserve chat SSE without buffering, the 30-second whole-chat deadline plus transport overhead, the 15-second position deadline, request cancellation and no-store behavior. Neither API nor its downstream reads SHALL be cached as current data. Successful HTTP admission MUST NOT be treated as successful inference or a confirmed financial action.

#### Scenario: Chat failure after admission

- **WHEN** `/api/chat` returns HTTP 200 followed by a terminal error or fallback
- **THEN** monitoring and acceptance SHALL record that terminal result rather than claim model success
- **AND** cancellation/deadline observations SHALL show no continuing new downstream work after abort

#### Scenario: Provider outage

- **WHEN** the model credential is absent or the provider is unavailable
- **THEN** `/api/position` SHALL remain independently usable with valid network/RPC/lending configuration
- **AND** missing/stale public data SHALL produce the existing typed failure instead of fixture data represented as live

### Requirement: Always-on separate watcher hosting

The watcher SHALL run as a separate supervised always-on Node process, with one active process per Guardian/key and no overlapping replacement replicas, autosleep or scale-to-zero. D29/B8 account and cost approval SHALL precede hosted operation. Railway approximately USD 5/month and Fly.io approximately USD 2.19 per 30 days SHALL be labelled historical 2026-11-04 recorded estimates, not current all-inclusive quotes. Render free's recorded 15-minute idle sleep makes it unsuitable for this requirement.

#### Scenario: Selecting a host

- **WHEN** the deployment owner proposes Railway or Fly.io
- **THEN** the founder SHALL approve current compute, persistent storage, backup and other applicable costs and account access before procurement
- **AND** unverified provider/volume/runtime properties SHALL remain labelled [U]

#### Scenario: Replacing an instance

- **WHEN** a watcher release is replaced or rolled back
- **THEN** the old instance SHALL stop before the new instance starts against the same Guardian/key/history
- **AND** already signed/submitted requests SHALL remain subject to reconciliation even after shutdown

### Requirement: Names-only environment and secret isolation

The deployment environment matrix SHALL enumerate only names present in `.env.example`, distinguish build-time `NEXT_PUBLIC_*` values, runtime public configuration, server secrets and watcher secret mounts, and contain no secret values. `NEARAI_API_KEY` SHALL exist only in the web server secret boundary; `CHAT_PROXY_SECRET` only at trusted edge/web server; watcher key files only in the watcher's private mount referenced by `WATCHER_KEYS_DIR`. The Guardian id SHALL remain the current watcher positional argument. No unsupported journal-directory variable or signing-enable override SHALL be invented.

#### Scenario: Secret distribution

- **WHEN** configuring web and watcher services
- **THEN** the owner SHALL distribute only each process's required configuration rather than copy the whole environment
- **AND** no provider/proxy/private-key secret SHALL enter browser configuration, public artifacts, logs or committed files

#### Scenario: Missing pricing or factory settings

- **WHEN** required browser/server fee or factory inputs are absent or disagree
- **THEN** the existing draft/Execute/Guardian-setup refusal SHALL be preserved
- **AND** missing atomic fee amounts MUST NOT be interpreted as zero or filled with guessed values

### Requirement: Per-network identity manifest

Each release SHALL record a separate per-network manifest covering RPC and fresh chain identity, lending id/version/provenance, oracle, token ids/units, factory/template/code, Guardian, owner, watcher and fee recipient, scoped public-key permission, fees/registration, artifact and approvals. Browser/server copies SHALL agree. Existing account creation, historical contract versions and read-only RPC observations MUST NOT be presented as current contract deployment, balances, scoped-key authority or write authorization. Unknown values SHALL be labelled [U].

#### Scenario: Wrong chain or lending version

- **WHEN** observed RPC identity differs from the selected network or a lending version is unsupported
- **THEN** the release SHALL refuse affected operations without fallback to another chain, guessed payload or browser variable

#### Scenario: Fixed-price public position

- **WHEN** public testnet data uses a fixed default price or a scenario/replay uses controlled prices
- **THEN** the fixed source SHALL remain disclosed and scenario/replay evidence SHALL be labelled **Simulated**
- **AND** the deployment owner MUST NOT claim fresh-oracle feasibility from that evidence

### Requirement: Authenticated edge identity and honest quota scope

A configured proxy SHALL use `CHAT_PROXY_SECRET`, `CHAT_PROXY_SECRET_HEADER` and `CHAT_PROXY_IP_HEADER` together. The trusted edge SHALL strip and overwrite both configured client-supplied headers, provide the secret and one validated authoritative IP, and prevent public direct-origin bypass. Raw forwarded headers and claimed account ids MUST NOT be treated as authenticated identity. Chat's 10 requests/60 seconds per transport identity and claimed account and position's 30 requests/60 seconds per transport identity and network/account SHALL remain explicitly per-process limits with their existing 4,096-bucket bounds. Multi-instance/serverless deployment SHALL have an edge-enforced aggregate quota before public exposure.

#### Scenario: Forged identity headers

- **WHEN** a client sends a forged proxy secret/IP header or reaches an alternate origin address
- **THEN** the deployed topology SHALL prevent the request from gaining trusted client identity or bypassing admission
- **AND** an unauthenticated direct client SHALL never gain authority merely by sending `X-Forwarded-For`

#### Scenario: Replica quota

- **WHEN** requests are served by multiple processes or a process is replaced
- **THEN** the owner SHALL document that local buckets do not coordinate or persist
- **AND** aggregate edge quota evidence SHALL be required rather than a global-limit claim based on one process

### Requirement: Preserve the hard-disabled public submission gate

The current public watcher entry SHALL remain read-only because `submissionAllowed: () => false` is hard-disabled in the implementation. Hosting, valid configuration, a clean nonce, sandbox success or a journal mount MUST NOT bypass that gate. A future signing-capable release SHALL require separately reviewed implementation, restart/history reconciliation, scoped authority, settlement/D27 public evidence, applicable D18/D19/B7 permissions and operation-specific authorizations. This plan SHALL NOT implement or authorize that release.

#### Scenario: Valid public key with closed gate

- **WHEN** the current public watcher or `operator:preflight` has valid network/configuration/scoped-key evidence
- **THEN** it SHALL still perform no signing or public submission
- **AND** the owner MUST NOT patch the gate, use the sandbox CLI publicly, substitute a full-access key or invent an override to make deployment appear functional

### Requirement: Durable signing history before future signing

Any future authorized signing release SHALL use private persistent signing-journal storage that survives container replacement and rollback, is scoped by network/Guardian and shared by all invocations for that target. Intent SHALL be durably recorded before signing and the signed hash durably recorded before broadcast. Existing, partial, unreadable, missing-history or uncertain records SHALL block new requests until independently reconciled. The existing optional single-use barrier SHALL NOT be described as a public integrated, reusable queue or recovery protocol.

#### Scenario: Crash or volume failure

- **WHEN** a future signer crashes around intent/sign/hash/broadcast, cannot sync its journal, or loses access to its durable history
- **THEN** no new request SHALL be signed or broadcast until independently reconciled
- **AND** restarting on an empty/ephemeral volume or deleting the record MUST NOT unlock signing

#### Scenario: Terminal observation and reuse

- **WHEN** the existing single-use barrier contains a record, even if a transaction later settles
- **THEN** another attempt SHALL remain blocked under the current barrier
- **AND** repeated public signing SHALL require a separately reviewed recovery/archive protocol, not manual record removal

#### Scenario: Backup restore or ambiguous outcome

- **WHEN** a restored snapshot is stale, a signed request times out, or a nonce advances without final correlated outcome evidence
- **THEN** the watcher SHALL remain read-only and preserve hashes/intents
- **AND** final receipts and Guardian state/history/reserve/debt SHALL be reconciled without blind re-signing or retransmission

### Requirement: Constrained authority and money-path invariants

The web/LLM SHALL hold no signer; manual actions SHALL require the user's wallet approval. Any future watcher signer SHALL permit only `request_repay` on one configured Guardian, zero attached deposit and finite function-call-key allowance, preserving Guardian I1-I10 and operational W1 (at most one unresolved request per Guardian without owner authority). Broad/wrong-network/wrong-receiver/wrong-method keys, over-limit requests, paused/stale/cooldown state and duplicate/uncertain requests SHALL have negative evidence before public enablement. The deployment SHALL NOT claim uptime, an audit or prevention of liquidation/loss.

#### Scenario: Full-access key in an existing account

- **WHEN** an account exists but only its full-access key is available
- **THEN** it MUST NOT be mounted as the watcher's signing key or treated as satisfying scoped-key preflight

### Requirement: Timestamp-qualified monitoring

The deployment SHALL collect the existing structured stdout heartbeat and show observation, read/evaluation freshness, monitoring/request mode, pending and error/backoff state without secrets. An external alert SHALL detect heartbeat or successful-read/evaluation age exceeding two 30-second polling intervals. Fresh reads in read-only mode MUST NOT be presented as enabled automatic protection. UI heartbeat integration, alert delivery and any HTTP health endpoint SHALL remain [U] until separately evidenced.

#### Scenario: Process alive but reads failing

- **WHEN** the process is running while last-successful-read/evaluation timestamps become older than 60 seconds
- **THEN** monitoring SHALL alert stale monitoring rather than report healthy protection
- **AND** the alert SHALL name the owner/recovery path without exposing key paths or raw provider errors

#### Scenario: Public web health

- **WHEN** monitoring observes API availability
- **THEN** it SHALL assess position provenance/freshness, chat terminal outcomes, admission/provider quotas and TLS/availability independently
- **AND** a 200 response or active process alone SHALL NOT constitute release acceptance

### Requirement: Authorized secret and watcher-key rotation

The owner SHALL rotate provider and proxy credentials through isolated secret stores, observe approved replacement behavior and revoke old credentials; proxy rotation SHALL preserve authenticated edge identity and blocked origins throughout. Watcher rotation SHALL stop the process, preserve/reconcile history, obtain account-owner approval, revoke/add only scoped keys and revalidate fresh final permissions. Guardian `watcher_id` changes SHALL require the Guardian owner's signed `rotate_watcher`. Every mainnet key/rotation transaction SHALL require explicit founder authorization.

#### Scenario: Watcher key compromise

- **WHEN** a watcher credential may be compromised
- **THEN** the owner SHALL stop operation, coordinate authorized revocation and reconcile pending history before replacement
- **AND** neither key rotation nor factory-default changes SHALL clear an unresolved request or open the public gate

### Requirement: Evidence-based preflight and postflight

The deployment owner SHALL complete the design's pre/post checklists with observed evidence before public release acceptance, including owner/host approvals, D25/P3.4 model acceptance before public model exposure, network/config/artifact alignment, transport/edge/secret checks, timestamped watcher read-only observation and alert/replacement/rollback rehearsals. Local tests, historical observations, sandbox evidence and actual public outcomes SHALL be distinguished. All execution tasks SHALL start unticked with owner placeholders; unknown inputs SHALL be labelled [U].

#### Scenario: Pending model acceptance

- **WHEN** a web build succeeds but D25/P3.4 acceptance is unresolved
- **THEN** the model endpoint MUST NOT be opened as an accepted public feature
- **AND** a restricted rehearsal or build success MUST NOT close the model or public-loop gate

### Requirement: Rollback without authority or history regression

Rollback SHALL restore the last reviewed compatible web artifact and matching browser/server configuration, stop the old watcher before replacing it, preserve signing history/key boundaries and remain read-only under uncertainty. Rollback MUST NOT delete journal records, reset history to manufacture certainty, widen keys, retry ambiguous transactions or upgrade keyless Guardians. Incident operations affecting contracts or funds SHALL require their existing owner/founder permissions.

#### Scenario: Reverting after a pending transaction

- **WHEN** a release is rolled back while a signed request may still execute
- **THEN** the known intent/hash and unresolved lock SHALL survive rollback
- **AND** stopping/replacing the process MUST NOT be described as cancellation or reversal of the transaction

#### Scenario: On-chain effects cannot be rolled back by hosting

- **WHEN** a deployed application/worker artifact is reverted
- **THEN** settled transactions, fees and existing Guardian code SHALL remain unchanged
- **AND** contract replacement/migration SHALL be a separately reviewed and authorized owner-controlled operation, not an automatic rollback step
