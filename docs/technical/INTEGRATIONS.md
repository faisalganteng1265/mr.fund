# Mr.Fund: integrations and setup

## TL;DR

- **Exercised:** historical public read-only RPC/catalog/tooling observations (2026-11-04), block-pinned Rhea adapter recordings, and local sandbox probe/Guardian reserve transactions (2026-11-06 onward). Sandbox uses generated local accounts and Simulated prices with imported deployed bytecode; it is not public network execution. Details and dates are recorded below and in BUILD-PLAN.
- Integration inventory observations from 2026-11-04 are historical; later evidence sections supersede their local implementation/toolchain status. Local real inference and read-only chat HTTP flows were exercised on 2026-11-08. Public account creation, deployment and wallet repayment remain unproven.
- D16 selected Option A on 2026-11-05; D18 G1 is decided. The local NEAR AI credential is available (B6 resolved for inference). Remaining external inputs include network (D19), testnet accounts/funding (B7), and watcher host (B8). See [OPEN-DECISIONS](../OPEN-DECISIONS.md#blockers).
- Secrets live only in each developer's local `.env` (gitignored) or the NEAR CLI keychain. Never in docs, chat, logs or commits.

## Integration inventory

| Integration | Purpose | Owner | Manual / automatic | Access or cost gate | Status and source |
| --- | --- | --- | --- | --- | --- |
| Rhea lending, testnet `contract.1689937928.burrow.testnet` | Loan reads and writes for the demo (D19) | external; lead integrates | automatic | Testnet tokens; 0.1 NEAR registration | Views exercised 2026-11-04; reports `0.11.0`; stablecoin prices null (B2) |
| Rhea lending, mainnet `contract.main.burrow.near` | Read-only engine validation; demo only if D19 step 3 | external | automatic reads; writes need founder approval | Real funds for writes | Views exercised 2026-11-04; reports `0.16.2` |
| Price oracle: testnet `pyth-oracle.testnet`, mainnet `aggregate-oracle.near` | Prices for engine and Guardian trigger | external | automatic | None for views; update fee for pushing prices [U] | Testnet USDC/DAI null at 60 s (2026-11-04) |
| NEAR RPC (FastNear) | Reads and transaction submission | external | automatic | Free public; numeric quota unpublished | Exercised; docs.near.org/api/rpc/providers |
| Wallet via NEAR Connect | User signing | user | manual approval per transaction | None | Documented; Meteor and Intear list testnet support in the connector manifest |
| NEAR testnet accounts | Deployer, factory, watcher, demo user | founder (B7) | manual creation, automatic use | Faucet | Not created |
| NEAR AI Cloud | LLM with tool calling | founder key (B6) | manual setup, automatic use | Credits required | [V] Real GLM tool-calling inference and local HTTP chat exercised 2026-11-08; model acceptance/limits in D25 and CHAT-API |
| Rust toolchain, `cargo-near`, `near-workspaces` | Contract build and sandbox tests | lead | automatic | None; sandbox needs Linux, macOS or WSL2 | Versions verified, not installed |
| Node and package manager | App, engine, watcher | lead | automatic | None | Latest Node 24 line is 24.22.2 (verified); `near-api-js` 7.4.0 needs Node ≥ 22.22.2; skills CLI needs ≥ 22.20.0. Package manager follows D16 |
| Watcher host | Always-on watcher (Option A) or Cron (Option C) | founder (B8) | manual account, automatic deploy with approval | Railway Hobby USD 5/month; Fly.io about USD 2.19 per 30 days; Cloudflare Workers Paid USD 5/month | Pricing pages read 2026-11-04 |
| Web hosting | Public demo URL | founder | manual | Follows D16 | Not chosen |
| GitHub `0xlann/mr.fund` | Public repository | 0xlann | manual | none | Created by the founder; `main` and `dev` pushed 2026-11-04 (D20, D22) |
| X post and submission | Required public demo and entry | 0xlann only | manual | Human-only by event rules | P6.4, P6.5 |
| NEAR Intents | Cross-chain funding (future, D13) | lead | — | Official: no testnet; community Tidepool sandbox exists | Future only; never claimed |

## P1.4 read adapter evidence (2026-11-06)

[V] `scripts/probes/record-rhea.mjs` exercised only public read-only views; it generates `fixtures/rhea/{testnet,mainnet}-reads.json` with provenance and decoded responses. Reproduce with `node scripts/probes/record-rhea.mjs testnet` and `node scripts/probes/record-rhea.mjs mainnet brianphan01.near`. The fixtures are historical recordings, never live product data. Testnet: block 276419739 / `2CwSM6GRX8jXaSBgDdiHx9DYW3eJy2MruF4zY3QRgGKX`, account `owner.1689937928.burrow.testnet`; mainnet: block 223245720 / `9upbo7URSwA6gqnr5pQVmQjYUF2arAC7EVSrGNkxdSvs`, account `brianphan01.near`. Assets pagination, config, account, Pyth mapping, token metadata, prices and configured derivative views were read at the same block per recording. Testnet oracle responses were null; fixed-price assets retained their configured prices. The generator records metadata RPC errors explicitly (including mainnet `aurora`); the runtime adapter refuses such failures with a typed error.

[V] Opt-in live adapter check passed: `RHEA_LIVE_READ=1 pnpm exec vitest run packages/rhea/test/live.test.ts --reporter=verbose --disableConsoleIntercept`; public mainnet `brianphan01.near`, block 223245899, engine health 258633 bps, data age 36595 ms. UI parity is unverified: web reader failed and computer-use browser host was unavailable. P1.4 stays unchecked pending that comparison. No account creation, key access, funds, deployment or transaction submission was involved. D30 records the user-approved switch from APY assumptions to protocol-reported APR fields.

## Trigger and Guardian progress (2026-11-06)

P0.4 update [V]: seven joined reads plus private callback passed sandbox health 57000 bps and null/expired-price rejection on both imported Rhea versions. Sample read-only gas burnt: testnet 30.586/30.952 Tgas, mainnet 31.605/32.106 Tgas (at-threshold/triggered); this does not prove composed repay allocation. P0.4/D27 remain open. `fixtures/trigger-vectors.json` is hand-computed, Simulated and asserted in Rust and TypeScript.

P2.1/P2.2 [V]: policy core and reserve lifecycle passed unit and sandbox tests, including keyless accounts, paid activation, deactivated withdrawal, real failed fee/withdrawal receipts and restored balances/refunds. This is not a public deployment, a factory-creation proof or chosen D24 pricing. The version-aware manual builder now uses `Repay.max_amount` on 0.11.0; its dust/overpay boundary was exercised with imported deployed bytecode. Existing historical recipe examples with strict `amount` describe only exact repayment; use `max_amount` for rounded/full repayment.

## Protocol encoding and numerical evidence (2026-11-07)

[V] Independent Rust assertions now cover all five `fixtures/encodings.json` syntax vectors. The same test-only encoder executes token registration, version-specific wallet dust repayment and fee transfer against the imported WASM; both versions also pass contract-owned partial/full repayment and exact borrow risk boundary checks. Modern liquidation event discount implies 8550 bps, agreeing with the engine on that vector. Legacy 0.11.0 omits discount fields, so scalar health remains unknown. Public display comparison again failed because the browser access host was unavailable. Full provenance, numerical scope and remaining gates: [PROTOCOL-EVIDENCE](PROTOCOL-EVIDENCE.md). No public write or deployment occurred.

## P4.3 backend outcome integration (2026-11-07)

[V, sandbox/recorded replay] Twelve raw outcome recordings now cover both imported Rhea versions, including successful repayment, supplied surplus, successful top-level returns with failed receipts, full refunds and failed fee transfers. Partial refund is explicitly from a sandbox-only NEP-141 receiver. Production read APIs validate the configured RPC network, request FINAL receipt details and reconcile a fresh final position without signing/sending/retrying. Missing post-state cannot create a confirmed repayment or pleased mood. See [REPAY-OUTCOMES](REPAY-OUTCOMES.md) for APIs, bounds and reproduction; B7/D19 public wallet proof and UI remain open.

## Chat runtime evidence (2026-11-08)

[V, local real inference/public reads] `POST /api/chat` was exercised through a running Next.js server against `z-ai/glm-5.3-flash` and public mainnet Rhea views for `brianphan01.near`. English, Indonesian and Spanish requests returned guarded model text with observed usage. No account creation, wallet access, signing, transaction submission or demo-network selection occurred. Initial gateway nullable usage metadata exposed a provider-adapter defect; the failing regression and subsequent live protocol check verified the correction.

[V, local production Next server, 2026-11-08] A separate actual Indonesian HTTP smoke (`scratch/chat-http-production-final.json`) returned HTTP 200 / terminal model status `ok` in 28,281 ms (27,171 ms agent loop), using two tools, four provider calls and one guard hit. The response separated collateral, non-collateral supply and debt from public mainnet reads. No signing, transaction submission or receipts occurred; this is one read-only flow, not full acceptance or public deployment.

The production Next build includes a dynamic `/api/chat` route. Transport, trusted-context construction, pricing prerequisites, provider failures, cancellation, budget and guard boundaries are covered by local tests. The multilingual fixed-snapshot benchmark uses explicitly **Simulated** positions/prices/Guardian responses with real inference; it is separate from the public-read HTTP smoke. Protocol, environment, replay and measured model evidence: [CHAT-API](CHAT-API.md), [D25](../OPEN-DECISIONS.md#d25-llm-model-open-lead).

[V] The latest complete 36-case live-inference run returned 34 model answers and two guard fallbacks. Automated number/card/claim checks and the language heuristic passed on guarded output; comparison-content checks failed. Completed independent assistant review (not human/provider review) found 36/36 correct language but only 22 content/honesty approvals and 14 rejections, including provenance uncertainty. A successful isolated repeat of the two comparisons is diagnostic only. **BLOCKER (owner: lead):** passing full live evidence and independent review are still required by D25/P3.4/OpenSpec 3.3 before chat deployment; B6 access is resolved, not the model gate. Review findings, the four-run evidence table and observed-cost estimates are in [CHAT-API](CHAT-API.md#observed-evidence-2026-11-08).

## Public position read configuration

[I, interface, 2026-11-10] `readPositionConfig(env)` is the shared web-server public-read configuration boundary: it requires explicit `NEAR_NETWORK_ID` (`testnet` or `mainnet`), credential-free HTTPS `NEAR_RPC_URL` without a fragment, and a syntactically valid, network-matching `RHEA_LENDING_ID`. It never reads browser variables, fees, model keys or factory configuration. Chat retains its optional enrichment configuration separately. The shared account predicate treats `testnet` and `.testnet` descendants as testnet, canonical lowercase 64-hex implicit ids as network-neutral, and other valid named ids as mainnet; syntax does not establish existence or ownership.

[I, interface, 2026-11-10] `createPositionLoader(config, fetch, verifyProvenance)` is request-scoped and checks RPC chain identity before delegating all snapshot parsing to unchanged `createRheaClient`/`readPosition`. Strict position reads intercept the config anchor, request `get_version` at that hash, accept only `0.11.0`/`0.16.2`, and preserve source hash/height/version plus typed failures. Chat explicitly disables that additional gate to preserve its existing optional proposal-version behavior. No factory, fee, model, retry or fixture fallback is involved in the public snapshot loader.

[I, wire interface, 2026-11-10] `presentPosition(snapshot, source, nowMs, maxDataAgeMs?)` returns the exact HTTP domain contract in `openspec/changes/add-position-read-api/design.md`: `ok`, `provenance`, account/network, pinned Rhea source, read/computation/data-age timestamps, supplied/collateral/debt lines, discriminated health/liquidation results, engine inputs and assumptions. All lending internal/atomic amounts and price multipliers are canonical strings; supply/collateral floor and debt ceils using existing shared/engine functions. Health is calculated from internal units, not those rounded strings. No-debt and other-collateral coverage are statuses, not infinity or zero market quotes. Unpriced non-collateral supply may remain null; unknown metadata refuses. A positive integer freshness override applies uniformly to all engine calls. This read-only view neither proves ownership nor authorizes a repayment.

[I, selector contract, 2026-11-10] GET `/api/position` accepts exactly one `accountId` and `networkId` query field; POST accepts precisely those two JSON fields and no query. Duplicate JSON keys (including escaped names), duplicate query parameters, unknown fields and malformed account ids refuse. Public selectors never choose an RPC URL, contract or version and never assert wallet ownership.

[I, HTTP contract, 2026-11-10] `/api/position` is independent of provider credentials. Success is HTTP 200 with the structured view above; every error is `{ok:false,error:{code,message},networkId}` and no balances/health. Static recovery messages map bad selectors to 400, network mismatch to 409, absent/all-zero lending positions to 404, transport/configuration unavailability to 503, stale data/unsupported version to 422, untrusted data to 502, deadlines to 504, cancellation to 499, size to 413, media type to 415, admission to 429 and other methods to 405 (`Allow: GET, POST`). Consumers must discard account/network mismatches and superseded responses. A Guardian id may be read explicitly as an account, without ownership discovery or action authority. Fixed prices remain visibly fixed, and local recording replays are not live evidence.

[I, deployment limit, 2026-11-10] Position admission shares chat's bounded local-process mechanics, not its quota: 30 requests per 60000 ms for the transport identity before parsing and separately for each network/account after validation, with 4096 combined buckets. Expired buckets are removed; active buckets are never evicted to make room. Rejection includes conservative `Retry-After: 60`. Both routes use the existing `CHAT_PROXY_SECRET` / secret-header / IP-header authenticated-edge contract; the edge must overwrite both headers. Without it all direct requests share one conservative bucket; raw X-Forwarded-For is never authoritative. These are not global anti-abuse limits: multi-replica deployments require an edge quota.

[I, transport contract, 2026-11-10] The position handler starts a 15000 ms whole-request deadline before parsing, combines caller cancellation with each adapter's 10000 ms downstream deadline, counts actual streamed POST bytes (1024 maximum) and UTF-8 query bytes (512 maximum), and caps RPC response bodies at 4 MiB. Shared `abortable` races non-cooperative dependencies while the propagated signal aborts physical fetch/body consumption. The loader retains downstream timeout causality around the adapter's generic transport error; no later view or retry begins after abort. Handler timers/listeners are removed on every terminal path. Every response and fetch is no-store, with no cross-request TTL/cache/background refresh. The owning architecture table's former short-cache proposal is explicitly reconciled to this decision.

### Local position integration evidence (2026-11-10)

[V, local only] After the complete cutover:

- `pnpm exec vitest run apps/web/test/position apps/web/test/server-admission.test.ts apps/web/test/chat packages/engine packages/rhea packages/agent --disableConsoleIntercept` → 43 files passed / 3 skipped; 728 tests passed / 3 skipped. Compiler-token dependency traversal inspected 35 reachable source modules, with no signer, sender, key loader, model, chat-only or fixture dependency. Existing chat tests were not changed. Mainnet/testnet recordings and implicit selectors, capped health, unsupported debt metadata and future non-collateral quotes are covered.
- `pnpm test` → 76 files passed / 3 skipped; 1017 tests passed / 3 skipped. Two existing jsdom `Window.scrollTo` not-implemented messages were printed; no tests failed.
- `pnpm typecheck` → all seven workspace projects passed; `pnpm lint` → 219 code files checked, no fixes/errors.
- `pnpm --filter @mrfund/web build` → compiled successfully; dynamic `/api/position` and `/api/chat` present. Build printed a missing-build-cache notice and the standard Next telemetry notice.
- Local built-server replay (below) returned GET 200 and POST 200 with identical health/debt/source, `no-store`, and DELETE 405 with `Allow: GET, POST`, while provider credentials were removed. The local harness injected an in-process fake fetch using historical testnet views and explicitly **Simulated** current oracle quotes; no public RPC or model was called. The replay source was block 276419739 / `2CwSM6GRX8jXaSBgDdiHx9DYW3eJy2MruF4zY3QRgGKX`, version `0.11.0`; health 387699932324063 bps, debt internal `121098520756`, rounded atomic `1`. These are replay outputs, not current public balances. The service was stopped after assertions, with no temporary script retained.

[V, local commands] The built-server replay was launched from `apps/web` with this command, then queried from the repository root:

```sh
node -e "process.env.NEAR_NETWORK_ID='testnet';process.env.NEAR_RPC_URL='https://rpc.invalid';process.env.RHEA_LENDING_ID='contract.1689937928.burrow.testnet';delete process.env.NEARAI_API_KEY;delete process.env.NEARAI_MODEL;delete process.env.MAX_DATA_AGE_MS;const r=JSON.parse(require('node:fs').readFileSync('../../fixtures/rhea/testnet-reads.json','utf8'));globalThis.fetch=async(target,init)=>{if(String(target)!=='https://rpc.invalid/')throw Error('Unexpected local replay target');const b=JSON.parse(String(init.body));if(b.method==='status')return Response.json({result:{chain_id:'testnet'}});const p=b.params;const args=JSON.parse(atob(p.args_base64));const found=r.calls.find(c=>c.contractId===p.account_id&&c.method===p.method_name&&JSON.stringify(c.args)===JSON.stringify(args));const data=p.method_name==='get_version'?'0.11.0':p.method_name==='get_price_no_older_than'?{price:'100000000',expo:-8,conf:'0',publish_time:Math.floor(Date.now()/1000)}:found?.data;if(data===undefined)throw Error('Unrecorded local replay view');return Response.json({result:{block_hash:r._provenance.blockHash,block_height:r._provenance.blockHeight,result:[...new TextEncoder().encode(JSON.stringify(data))]}})};process.argv=['node','next','start','--port','3148'];require('next/dist/bin/next');"
node --input-type=module -e "const endpoint='http://127.0.0.1:3148/api/position';const selectors={accountId:'owner.1689937928.burrow.testnet',networkId:'testnet'};const query=new URLSearchParams(selectors);const results=[];for(const method of ['GET','POST']){const response=await fetch(method==='GET'?endpoint+'?'+query:endpoint,{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify(selectors)}:{})});const value=await response.json();if(response.status!==200||response.headers.get('cache-control')!=='no-store'||!value.ok||value.accountId!==selectors.accountId||value.networkId!=='testnet'||value.source.lendingVersion!=='0.11.0')throw Error('Built route contract failed: '+JSON.stringify(value));results.push(value);console.log(JSON.stringify({evidence:'LOCAL SIMULATED FETCH REPLAY, NOT LIVE RPC',method,status:response.status,cacheControl:response.headers.get('cache-control'),source:value.source,health:value.health,debt:value.debt.map(d=>({tokenId:d.tokenId,internal:d.internal,atomic:d.atomic}))}));}if(JSON.stringify(results[0].debt)!==JSON.stringify(results[1].debt)||JSON.stringify(results[0].health)!==JSON.stringify(results[1].health))throw Error('GET/POST mismatch');const response=await fetch(endpoint,{method:'DELETE'});if(response.status!==405||response.headers.get('allow')!=='GET, POST')throw Error('Method refusal failed');console.log('Built-route local assertions passed: GET, POST and DELETE refusal; no provider credentials or public RPC');"
```

[U] Current usable public testnet position/prices and real HTTP read parity remain unestablished. Tasks 4.1/4.2, D19, P1.2/P1.4 public UI parity and P4.3/P4.5 wallet/public repayment acceptance remain open. The interface and explicit no-cache decision above are local implementation documentation, not completion of those external gates.


## Environment variables (names only)

`.env.example` will list these names with empty values at P0.7. Values never enter git.

| Name | Consumer | Purpose | Class |
| --- | --- | --- | --- |
| `NEAR_NETWORK_ID` | all | `testnet` or `mainnet` | public |
| `NEAR_RPC_URL` | server, watcher, scripts | For example `https://test.rpc.fastnear.com` | public |
| `NEXT_PUBLIC_NEAR_NETWORK_ID`, `NEXT_PUBLIC_NEAR_RPC_URL` | web app | Browser copies of the above (Next.js exposes only `NEXT_PUBLIC_*`, D16) | public |
| `RHEA_LENDING_ID` | all | Lending contract for the network | public |
| `GUARDIAN_FACTORY_ID` | all | Factory account | public |
| `NEXT_PUBLIC_RHEA_LENDING_ID`, `NEXT_PUBLIC_FEE_RECIPIENT_ID` | web app (execution verifier) | Browser copies of `RHEA_LENDING_ID` and `FEE_RECIPIENT_ID`; must match them; missing or wrong-network values block Execute | public |
| `NEXT_PUBLIC_GUARDIAN_FACTORY_ID`, `NEXT_PUBLIC_GUARDIAN_ACTION_FEE_ATOMIC` | web app (live Guardian panel) | Browser copy of `GUARDIAN_FACTORY_ID` and the per-action fee (debt-token atomic units, D24) written into a new policy; missing or wrong-network values block Guardian setup, never default | public |
| `FEE_RECIPIENT_ID` | factory deploy, web app (display) | Fee recipient account | public |
| `WATCHER_ACCOUNT_ID` | watcher, factory policy defaults | Watcher account | public id |
| `WATCHER_KEYS_DIR` | watcher | Directory with the watcher's function-call key files (one per Guardian) | secret path |
| `WATCHER_OPERATOR_JOURNAL_DIR` | explicit testnet operator | Absolute private persistent shared journal directory; never reset to permit another attempt | private path |
| `NEARAI_API_KEY` | chat API only | NEAR AI Cloud bearer key | secret |
| `NEARAI_BASE_URL` | chat API | `https://cloud-api.near.ai/v1` | public |
| `NEARAI_MODEL` | chat API | Model id chosen in D25 | public |
| `FEE_TOKEN_ID`, `FEE_ACTIVATION_ATOMIC`, `FEE_ACTION_ATOMIC`, `FEE_EXECUTION_ATOMIC` | chat API | Complete explicit fee configuration with `FEE_RECIPIENT_ID`; integer token atomic amounts; missing pricing disables drafts | public |
| `CHAT_PROXY_SECRET` | chat/position APIs / trusted edge | Authenticates the edge-overwritten client-IP header; never `NEXT_PUBLIC_*` | secret |
| `CHAT_PROXY_SECRET_HEADER`, `CHAT_PROXY_IP_HEADER` | chat/position APIs / trusted edge | Header names used only with the matching proxy secret; otherwise all direct requests share one IP bucket | public names |
| `MAX_DATA_AGE_MS` | engine consumers | Freshness limit for advice and cards (default proposal 120000) | public |

### Public position read evidence (2026-11-13)

[V, public testnet RPC through a local Next dev server] `add-position-read-api` 4.1: GET, POST and a repeated GET for the public read selector `juaner116.testnet` on Rhea testnet `0.11.0` returned HTTP 200 at blocks 277463304/319/333 with data ages 3637/4098/3114 ms, and exact-block re-reads through the shared loader and engine matched health with zero bps difference. Commands, block hashes and latencies are in CHAT-API "Public testnet HTTP read smoke".

Reconciled reading of the API after that run:

- Read-only: `/api/position` only performs final-block view calls; it never signs, sends, asserts wallet ownership or chooses an RPC URL, contract or version from the request.
- No cache: every request, including the repeated GET, starts a fresh final-block read (ARCHITECTURE "Rhea read adapter", explicit no-cache decision of 2026-11-10; the earlier cache-table proposal is removed there).
- Network match: consumers discard any response whose account or network differs from the session's, and any superseded response (409 on a network mismatch).
- Provenance: the observed wNEAR input is Rhea's fixed `default_price`, not a market quote; the 2026-11-10 local replay above uses a recording with **Simulated** current oracle quotes and is never live evidence.
- Not covered: public Rhea UI parity (P1.2/P1.4), moving prices, wallet signing and public repayment (P4.3/P4.5) remain open under their own acceptances.

### Watcher local runtime

The watcher's public path runs on Linux, macOS or WSL2 only: durable journal
directory `fsync` and `O_NOFOLLOW` symlink protection are required, and native
Windows Node cannot provide these guarantees. Run WSL2 processes on a Linux
filesystem and keep the journal on private persistent storage.

[V, local implementation] `pnpm --filter @mrfund/watcher start <guardian-account-id>` reads `NEAR_NETWORK_ID`, `NEAR_RPC_URL`, `WATCHER_ACCOUNT_ID` and `WATCHER_KEYS_DIR` from its process environment. The directory contains `<guardian-account-id>.json` in near-cli key-file shape, with a matching watcher `account_id`, `public_key`, and `private_key` or `secret_key`. The runtime rejects symlinks, mismatched accounts/keys, invalid networks and non-HTTPS endpoints. It verifies fresh node status and final access-key permissions for exactly one `request_repay` receiver and method before starting. Never commit a key file or print its contents.

Run only one process per Guardian/key. The initial access-key nonce cannot establish whether an earlier signed request is unresolved, so by default startup remains `read_only` and the submission gate is closed: a run without the flags below sends no transaction. Polling uses fresh, block-pinned Guardian and position views, while JSON heartbeat lines show observation, successful-read and evaluation timestamps, pending/error flags and backoff. A running process is not proof of a fresh observation. SIGINT/SIGTERM stop scheduling. No uptime or liquidation-prevention guarantee is implied. Hosted operation requires D29/B8.

[V, local implementation; not yet run against a public network] **Single-request mode (testnet only).** `pnpm --filter @mrfund/watcher start <guardian-account-id> --submit-testnet --confirm-exclusive-key --confirm-prior-requests-reconciled --confirm-persistent-journal`, with `WATCHER_OPERATOR_JOURNAL_DIR` set to an absolute, owner-only, persistent Linux directory, lets the scheduled watcher sign **one** `request_repay` for the life of that journal. Permission boundary: only the scoped function-call key (one receiver, `request_repay` only, finite allowance), only after the engine's trigger check on fresh views, only through the single-use write-ahead journal. Invariant: the gate closes before the journal write, so a failed write, a contract rejection or a restart cannot become a second send; a journal that already holds a request leaves the watcher read-only (`submit_mode` line `single_request_used`) until the operator reconciles it by hand from the recorded hash and the Guardian history (the over-limit operator's lookup only recognises a rejection, so it does not close an executed repay). Any missing, extra or duplicate flag, a non-testnet network or a relative directory fails startup. It does not guarantee the request succeeds (the contract re-checks trigger, cooldown and limits), that more than one repay happens, or any uptime; the three confirmations are operator attestations the watcher cannot verify.

The separate testnet-only over-limit operator and its dry-run are documented in
[WATCHER-SANDBOX](WATCHER-SANDBOX.md). They require independent key-history and
persistent-storage attestations; neither the runtime nor an empty journal proves
them. No public request is evidenced by the local implementation.

## Step-by-step recipes

Commands are **planned, not run** unless marked exercised. Writes need the authorization noted.

### 1. NEAR testnet accounts (B7)

Docs: https://docs.near.org/tools/cli (near-cli-rs latest release `v0.30.1`, 2026-09-02, read 2026-11-04); faucet https://near-faucet.io/ (docs: may run dry).

Human steps (founder, or the lead with explicit authorization):
1. Choose ids: `<ns>.testnet` as deployer, `guardian.<ns>.testnet` as factory, `watcher.<ns>.testnet`, `demo-user.<ns>.testnet`, `fees.<ns>.testnet`.
2. Create with the faucet-sponsored command and keep keys in the OS keychain: `near account create-account sponsor-by-faucet-service <id> autogenerate-new-keypair save-to-keychain network-config testnet create` (syntax per the CLI docs; confirm with `near account --help` first).
3. Write account ids, never keys, into `.env` and into SMART-CONTRACT "Deployment".

Verification (planned): `near account view-account-summary <id> network-config testnet now` shows a non-zero balance. Stop if the faucet is empty and tell the founder.

Observed [V, testnet, 2026-11-11 10:19 UTC]: the user authorized account creation and faucet funding. The following balances and matching full-access public keys were verified at final block `277201955` (`FvaZrGxaaAxMECLV6AxJnsrfie12fLYm97zUFddVWBEm`). Each balance was exactly `10000000000000000000000000` yoctoNEAR (10 NEAR); storage is locked within the account balance. The generated private keys are in the local gitignored `.env` per user instruction and are not recorded here.

| Role | Account | Faucet creation transaction |
| --- | --- | --- |
| Deployer | `mrf-b1ce96af6a.testnet` | `6ddG2vUeF8QmZ83wKWyL7e29mN5qA1qQQ24wJCfr9J3G` |
| Factory account | `f-mrf-b1ce96af6a.testnet` | `9QmsqfFs3zJy94Yho6W42YQQ9dfN285FNkhcsYhiExP2` |
| Watcher | `w-mrf-b1ce96af6a.testnet` | `DxfmuHhWs6wC9oykGmjTc3zG6SN1pju3ZLdCWoSJRAVc` |
| Demo user | `d-mrf-b1ce96af6a.testnet` | `Cue8aSHy5BBtXhWp58ic3z91B7VFdJwrVtTR7m4MEG7o` |
| Fee recipient | `fee-mrf-b1ce96af6a.testnet` | `GXHjMGHrsf8kTyCzGH8c5XwWnxBfygsc4CQojV5QRnQY` |
| Probe | `p-mrf-b1ce96af6a.testnet` | `J23KbzGVz5gCDuc99Ps79gSvzj4KXZykjbNm4h6zREbN` |

The factory account now holds the D24 factory template (see SMART-CONTRACT "Testnet factory deployment"). The watcher keeps its full-access key and, since 2026-11-13, a second key restricted to `request_repay` on the first Guardian with a 1 NEAR allowance; the full-access key must not be used for watcher submissions. A read-only `get_asset` confirmed `usdc.fakes.testnet` and `wrap.testnet` are listed on testnet Rhea with borrowing and deposit enabled.

Test-token sourcing [V, testnet, 2026-11-11 10:31–10:34 UTC]: the demo user registered on [`wrap.testnet`](https://testnet.nearblocks.io/txns/8EghLyCzAq5hobThQ67xkeJuCMHPF9pdYMXbgtW7dtGv) and [`usdc.fakes.testnet`](https://testnet.nearblocks.io/txns/CdESVdFb9aP3ekMB7SV4kuggRj9foANwLyLQxjGRXPRx), locking 0.00125 NEAR per token, and [wrapped 0.1 NEAR](https://testnet.nearblocks.io/txns/GoyEunRbtFKredRrtSvPqrvF3Z81uMkcemt2kAWh9gQQ). The initial [swap attempt](https://testnet.nearblocks.io/txns/9wKdQBqnHb5t61YSDHQa6VWom3MBpZXNeSeSA4ima7iR) had a failed DCL receiver receipt: `E600` rejected an empty `referral_id`; the resolver refunded the full 0.1 wNEAR and USDC stayed at zero. After observing that refund, a separately signed [corrected swap](https://testnet.nearblocks.io/txns/CT8SwUm8HgWTzLU1YuKTafVEeRfjKSt49R57rNm7rTvB) through `dclv2.ref-dev.testnet` pool `usdc.fakes.testnet|wrap.testnet|2000` omitted the invalid optional fields. A fresh quote at block 277203469 was `27801099472` USDC atomic units; the 1% slippage minimum was `27523088477`. The final transaction had 10 receipts and no failed receipts.

At final block `277203522` (`5DZxXFUak724bgMmgqyjcPbyQocxFz2QjwLubq3Vh4xx`), the demo user held `27801099472` atomic units (27,801.099472 USDC.e testnet, 6 decimals), `0` wNEAR and `9894045886486078099999998` yoctoNEAR. The testnet pool's quote is not a real market price. These observations establish a source for both listed assets, not a completed Rhea lending cycle or usable oracle prices. Full bounded transaction outcomes are local under ignored `scratch/testnet-usdc-source-*.jsonl`.

### 2. Rhea lending reads (exercised read-only)

Docs: https://guide.rhea.finance/developers/contracts.md ; source `https://github.com/ref-finance/burrowland` @ `2110c7047f2d72a9189abcbaad5eafb4e4a87f9e` (only published ref).

Exercised probe (lead, 2026-11-04), one JSON-RPC object per POST:

```text
POST https://test.rpc.fastnear.com
{"jsonrpc":"2.0","id":"x","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"contract.1689937928.burrow.testnet","method_name":"get_version","args_base64":"e30="}}
```

Observed: `"0.11.0"` at block 276211785. The same call on `https://free.rpc.fastnear.com` for `contract.main.burrow.near` returned `"0.16.2"` at block 223033646; mainnet `get_config` showed `pyth_oracle_account_id: "aggregate-oracle.near"`, `enable_pyth_oracle: true`, `pyth_price_valid_duration_sec: 60`.

Views the adapter uses: `get_account(account_id)`, `get_account_all_positions(account_id)`, `get_assets_paged_detailed(from_index, limit)`, `get_asset(token_id)`, `get_config()`, `get_token_pyth_info(token_id)`, `get_all_token_pyth_infos()`, `storage_balance_of(account_id)`, `storage_balance_bounds()`.

Units: account-view balances are Rhea internal units; divide by `10^extra_decimals` for token atomic units. Testnet `usdc.fakes.testnet` and `usdt.fakes.testnet` have `extra_decimals: 12`; `dai.fakes.testnet` has 0 (observed 2026-11-04).

### 3. Rhea lending writes (P0.2, P0.3; testnet only until D19 says otherwise)

Agent steps (planned, need B7 accounts):
1. `storage_deposit` on the lending contract for the acting account (live minimum `100000000000000000000000` yoctoNEAR = 0.1 NEAR).
2. Register the acting account on each token contract (`storage_deposit` on the token).
3. Supply and collateralize: token `ft_transfer_call` to lending with `msg` `{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":"<token>"}}]}}` and 1 yocto.
4. Borrow and withdraw: lending `execute_with_pyth` with `[{"Borrow":{"token_id":"<debt>","amount":"<internal>"}},{"Withdraw":{"token_id":"<debt>","amount":"<internal>"}}]` and 1 yocto.
5. Repay: on mainnet `0.16.2`, debt token `ft_transfer_call` to lending with `msg` `"\"OnlyRepay\""` and 1 yocto. **Deployed testnet `0.11.0` rejects `OnlyRepay`** [V, sandbox with the downloaded testnet bytecode, 2026-11-06, P0.3]; there use `msg` `{"Execute":{"actions":[{"Repay":{"token_id":"<debt>","amount":"<internal>"}}]}}`, where the outer `amount` is token atomic units and the inner `amount` is Rhea internal units (atomic × `10^extra_decimals`). The message depends on the deployed version; never retry one as a fallback for the other.
6. Release: `execute_with_pyth` with `DecreaseCollateral` then `Withdraw`.

Verification: each step's transaction outcome has no failed receipt; `get_account` reflects the change. Record hashes here. Stop condition: a priced step fails with a missing-price error; go to recipe 4.

Observed Gate 1 plain-account cycle [V, testnet, 2026-11-11 15:43–15:45 UTC; `prove-testnet-guardian-loop` 2.2]: the user authorized the plan; demo user `d-mrf-b1ce96af6a.testnet` signed every write with `waitUntil: FINAL`. Collateral `wrap.testnet` and debt `ref.fakes.testnet` both use fixed `default_price` values (recipe 4), so this is the **fixed-price partial pass**: health does not move with any market and price-driven beats stay Simulated. Bounded outcomes with before/after `get_account` and balances are in ignored `scratch/gate1-2026-11-11.jsonl`.

| Step | Transaction | Block after | Result |
| --- | --- | --- | --- |
| Rhea `storage_deposit` 0.1 NEAR | [`GBFMXpSS…`](https://testnet.nearblocks.io/txns/GBFMXpSSbhSwna66bkfo9UHg5diezd3rURd3VcwSw3rS) | 277235437 | Registered; empty position |
| `ref.fakes.testnet` `storage_deposit` 0.00125 NEAR | [`5hXemhto…`](https://testnet.nearblocks.io/txns/5hXemhtovFnCuFm59sau1tZNDb4xXxdJ2ZprJ2GaXFTq) | 277235451 | Registered |
| `near_deposit` 0.51 NEAR | [`9hqJXFd6…`](https://testnet.nearblocks.io/txns/9hqJXFd6gYob4Dm8vZPLVAB789LAUaY6Zn2ahg3Jhg2D) | 277235464 | 0.51 wNEAR |
| Swap 0.01 wNEAR → REF, DCL pool `ref.fakes.testnet\|wrap.testnet\|2000` (`{"Swap":{pool_ids,output_token,min_output_amount}}`, 1% slippage) | [`14APowF1…`](https://testnet.nearblocks.io/txns/14APowF1T2aUjcEmBxvz2RnQ3qFY1zQPHtTN7iX8FF7S) | 277235484 | 12.915966163152627515 REF (equal to the quote) |
| 0.5 wNEAR `ft_transfer_call` `{"Execute":{"actions":[{"IncreaseCollateral":{"token_id":"wrap.testnet"}}]}}` | [`FKdmfv3L…`](https://testnet.nearblocks.io/txns/FKdmfv3LYmvSmiod8MhD75QD9WcTnSpFPCAnzsJj7HsB) | 277235514 | Collateral 0.5 wNEAR |
| `execute_with_pyth` Borrow + Withdraw 1 USDC | [`GkmSCzi3…`](https://testnet.nearblocks.io/txns/GkmSCzi3p6HmVFPLJnjgeiCjLQF47h333rmRsF4DNZzc) | 277235533 | **Rejected**: `Missing usdc.fakes.testnet price` (`pyth.rs:155`); position unchanged |
| `execute_with_pyth` Borrow 0.5 REF + Withdraw 0.5 REF (exact) | [`CGg8BBkH…`](https://testnet.nearblocks.io/txns/CGg8BBkHye8583BoABn5xt2d15LJw2p4sXdVjtFr4C7Q) | 277235554 | **Rejected**: `Not enough asset balance`; whole call reverted, position unchanged (see share rounding below) |
| `execute_with_pyth` Borrow 0.5 REF + Withdraw (amount omitted) | [`88WMGMtm…`](https://testnet.nearblocks.io/txns/88WMGMtmKXU24ST7jAdZcghJ2YDoAboWV2Ty9j6j4BLo) | 277235624 | Debt 0.500000000435016701 REF; 0.5 REF − 1 atomic reached the wallet |
| 0.6 REF `ft_transfer_call` `{"Execute":{"actions":[{"Repay":{"token_id":"ref.fakes.testnet","max_amount":"600000000000000000"}}]}}` | [`HQJD8gzr…`](https://testnet.nearblocks.io/txns/HQJD8gzrtQU6PpJq5mWLnUzuYmy6WN8Un2vFtdWjc36x) | 277235640 | Debt 0; the excess stayed supplied (0.099999997174169570 REF) |
| `execute_with_pyth` DecreaseCollateral + Withdraw wNEAR (amounts omitted) | [`HhCtJKxf…`](https://testnet.nearblocks.io/txns/HhCtJKxfNCxyxYEzz9cF4CXEtAPdH5eRzVJLv3FK5ouh) | 277235656 | Collateral 0; 0.500001292110087790524287 wNEAR back in the wallet |
| `execute_with_pyth` Withdraw REF (amount omitted) | [`9V22uWmt…`](https://testnet.nearblocks.io/txns/9V22uWmtPL5pSyFHE8M9BzvcWeTw7dLruT33ox6MkFmw) | 277235673 | Supplied, collateral and borrowed all empty |

Costs: 0.010645 NEAR burnt in gas across the 11 transactions (rejected ones included), 0.1 NEAR locked in Rhea storage and 0.00125 NEAR in REF storage; the cycle's REF cost was 0.000000002732103006 REF of interest. No `OnlyRepay` was attempted on `0.11.0`.

Share rounding [V, testnet arithmetic at the failed borrow]: Rhea credits a borrow to `supplied` as `floor(amount × shares / balance)` shares and debits an exact-amount `Withdraw` as `ceil(…)`. With the REF pool at 370481008160211288092408 shares / 377384644082526848374484 balance, 0.5 REF credited `490853316330478637` shares and the same-amount withdraw needed `…638`. Any pool whose share price is not exactly 1 makes `Borrow(x)` + `Withdraw(x)` revert; omitting the `Withdraw` amount takes what was credited (1 atomic less). The sandbox did not show this because its fresh pools were 1:1. **Consequence for the Guardian [I, not yet exercised]:** `owner_borrow` and `owner_withdraw_collateral` (P2.4) send exact-amount `Withdraw` actions, so on these testnet pools they are expected to revert; and the demo's planned USDC debt cannot be borrowed until a fresh USDC price exists. Both need a lead decision before P2.8 (`prove-testnet-guardian-loop` 4.1).

Borrow share arithmetic and a Guardian borrow on testnet [V, testnet, 2026-11-13]: the two real borrows of 0.5 REF on Rhea `0.11.0` below were re-read through the archival RPC (`https://archival-rpc.testnet.near.org`, read-only) at the execution block and the block before, and `projectBorrow` in `packages/engine/src/open-position.ts` reproduces each exactly: debt shares issued `ceil(amount x S / B)`, debt balance `ceil(shares x B' / S')`, supplied credit `floor(amount x Ss / Bs)` and delivered tokens `floor(credit x Bs' / Ss')`. Pool balances used are the interest-updated values at that block (post-state minus the borrow's own effect). The vectors, with account shares, are in `packages/engine/test/fixtures/rhea-borrow-vectors.json`.

| Borrow | Transaction | Execution block | Shares issued | Delivered |
| --- | --- | --- | --- | --- |
| Plain account (Gate 1, `d-mrf-b1ce96af6a.testnet`) | [`88WMGMtm…`](https://testnet.nearblocks.io/txns/88WMGMtmKXU24ST7jAdZcghJ2YDoAboWV2Ty9j6j4BLo) | 277235621 | 455437522116155388 | 499999999999999999 REF atomic |
| Throwaway Guardian `guardian-test.p-mrf-b1ce96af6a.testnet`, `owner_borrow` with the amountless `Withdraw` | [`BBqxGynp…`](https://testnet.nearblocks.io/txns/BBqxGynphs8QsZKKA2hTw1rMEuHc682qghDJMMyzT7mp) | 277496824 | 455397840517430870 | 499999999999999998 REF atomic |

The Guardian run (owner `d-mrf-b1ce96af6a.testnet`; non-reproducible `cargo build` wasm with only the `owner_borrow` change, on-chain code hash `8jzmziTg2iFssrtFiNxneNZvd3Ci9s7okLKgYWPdtGWM`; full-access key kept, so not the keyless production shape) also did: creation, deploy and `new` in one transaction [`JLKcZfi2…`](https://testnet.nearblocks.io/txns/JLKcZfi2NAJzm6gU3NeZG89TPpfXtRDvwkjUKzmVwu8), `owner_register` for lending [`DBt4ezkk…`](https://testnet.nearblocks.io/txns/DBt4ezkkzyoY8A6bUzYUEdGKQS84QMyCEKe9uwauPwrE), REF [`CLWZue2y…`](https://testnet.nearblocks.io/txns/CLWZue2ysziqt2qkQ8P744qoxczosfxqGGgb7NQNKS8t) and wNEAR [`HUNcSk5r…`](https://testnet.nearblocks.io/txns/HUNcSk5rpFj9ruNB5Si2a7UHevgn778svBeHdgyVZAkc), a 1 wNEAR collateral deposit [`BxMBmgy7…`](https://testnet.nearblocks.io/txns/BxMBmgy7pfHw7eEPJTHv5ynQUVKahDwAwBLecoS63Pgo), and `owner_sweep` of the borrowed REF back to the owner [`GGpNirtZ…`](https://testnet.nearblocks.io/txns/GGpNirtZu6sYtPeYhMSR1ic9tRCD9WxErVwjjtsYJYnn). Every transaction was FINAL with no failed receipt; gas burnt across the seven was 0.0198 NEAR and 5.6 NEAR moved to the sub-account (about 5.2 NEAR locked as code storage). This is the public-network run of a fixed Guardian that BUILD-PLAN P0.3 lacked for `owner_borrow`; it did not cover `owner_withdraw_collateral`, repay, release, Rhea `0.16.2` or the factory-created shape, and the account still holds the 1 wNEAR collateral and 0.5 REF debt. REF prices here are Rhea's fixed `default_price`.

### 4. Testnet price freshness (P0.2, B2)

Observed (lead, 2026-11-04): `pyth-oracle.testnet` `get_price_no_older_than({"price_id":"41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722","age":60})` returned `null` at block 276211786 (this is the USDC feed id mapped by the testnet lending contract).

Read-only refresh investigation [V, testnet, 2026-11-11 10:39:52–10:40:46 UTC]: at final block `277204155` / `GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi`, Rhea `0.11.0` configured `pyth-oracle.testnet`, enabled Pyth and required prices at most 60 seconds old. USDC, wNEAR and REF all allowed deposit, withdrawal, collateral and borrowing. Token decimals / Rhea extra decimals were respectively USDC `6/12`, wNEAR `24/0`, REF `18/0`. USDC's mapped feed was `41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722` with no default; wNEAR and REF had fixed `default_price` values (`960`/`10^26` and `250`/`10^20` respectively, in the contract's configured units). These defaults are not live market prices. `get_price_no_older_than` returned `null` for the USDC and DAI feeds; neither returned a publish time. At final block `277204240` / `7JQnxvQi73vDwNiDMg2oUCH9sMvSaRvjw91MTWbAgMXa` (10:40:41 UTC), USDC `get_price_unsafe` returned `{price:"99976920",conf:"42079",expo:-8,publish_time:1780781716}`: the publish time is 2026-06-06 21:35:16 UTC, **13,611,925 seconds old** at that block. The unsafe value is not a usable fresh quote.

The on-chain oracle code hash at block 277204155 was `EPb64c8r61hbJBPsPdzsZ8Ui2JfBQ9Z2pXXcLDfN2Khm`; its downloaded ABI identifies payable `update_price_feeds({data: string})` and view `get_update_fee_estimate({data: string})`. `get_sources` reported chain `26` and emitter `e101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71`. The deployed ABI does **not** establish that a current signed update is compatible or reveal its actual fee without the update data. Unauthenticated requests for the mapped USDC feed to `https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722` and `https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids%5B%5D=41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722` returned HTTP 401 at 10:40:46 UTC. The [Hermes API reference](https://docs.pyth.network/api-reference/hermes/latest-price-updates) requires an API key, and [Pyth's current documentation](https://docs.pyth.network/pro/use-prices-on-blockchain#no-longer-supported) lists NEAR among chains no longer supported by Pyth Core. This does not by itself prove whether a particular signed update would be rejected by the legacy contract.

Reproduction (all read-only; `near-cli-rs 0.30.1`):

```sh
near contract call-function as-read-only contract.1689937928.burrow.testnet get_config json-args '{}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only contract.1689937928.burrow.testnet get_all_token_pyth_infos json-args '{}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only contract.1689937928.burrow.testnet get_asset json-args '{"token_id":"usdc.fakes.testnet"}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only contract.1689937928.burrow.testnet get_asset json-args '{"token_id":"wrap.testnet"}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only contract.1689937928.burrow.testnet get_asset json-args '{"token_id":"ref.fakes.testnet"}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only pyth-oracle.testnet get_price_no_older_than json-args '{"price_id":"41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722","age":60}' network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
near contract call-function as-read-only pyth-oracle.testnet get_price_unsafe json-args '{"price_identifier":"41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722"}' network-config testnet at-block-hash 7JQnxvQi73vDwNiDMg2oUCH9sMvSaRvjw91MTWbAgMXa
near contract call-function as-read-only pyth-oracle.testnet get_sources json-args '{}' network-config testnet at-block-hash 7JQnxvQi73vDwNiDMg2oUCH9sMvSaRvjw91MTWbAgMXa
near contract download-abi pyth-oracle.testnet save-to-file scratch/testnet-pyth-abi-pinned.json network-config testnet at-block-hash GZECDfngQdcoPZnWn4JE5NFh5erydSv2ZLFui1uoDHKi
```

Stop decision: no signed feed was obtained, no actual update-fee estimate was measured, and no oracle update transaction was sent or rejected. Do not invent a fee or submit a guessed update. The existing fixed-price wNEAR/REF configuration is a possible partial-demo path, not a tested lending pass; any price-driven replay remains labelled Simulated. Task 2.1 remains open pending a verified compatible feed and fee or an explicitly reviewed change to its acceptance.

Agent steps (planned): verify a compatible signed update for the mapped feed, query the deployed oracle's exact fee for that payload, and verify the update path before submitting anything. Current signed-feed access, compatibility and fee remain [U], so stop before an update. If a later authorized update is submitted, record every receipt and re-read the price; a rejected update remains visible and does not automatically authorize a fallback or price claim.

### 5. Wallet connection (P4.3)

Docs: https://docs.near.org/tools/near-connect.md and https://docs.near.org/web3-apps/tutorials/wallet-login.md (read 2026-11-04). Package `@hot-labs/near-connect` 0.12.0; initialize with `new NearConnector({ network: "testnet" })`; sign with `wallet.signAndSendTransaction(s)`; read state through RPC, not the connector.

Human steps: install a wallet that supports testnet (Meteor and Intear declare testnet support in the connector manifest; HOT does not declare it; NEAR Mobile declares `testnet: false`). Passkey sign-in via NEAR Auth is documented (testnet open, mainnet needs approved client credentials) and stays optional.

Verification boundary: account/RPC reads do not require signing. Real transaction approval and the first observed repay belong to P4.5 and require their own outcome evidence. Browser login does not prove either.

#### Dual-login module handoff (D31)

Status [V, local, 2026-11-08]: NEAR Auth/NEAR Connect adapters and framework-independent account lifecycle are implemented in `apps/web/src/wallet/`. User deferred all UI-related work; no React provider, `/connect` screen or root/home changes ship. P4.3a remains open for frontend integration and real login evidence.

| Module | Contract |
| --- | --- |
| `config.ts` | `readWalletConfig({network, rpcUrl, authClientId?})`: explicit testnet/mainnet and HTTPS RPC; never silently chooses a network |
| `accounts.ts` | `validateAccounts(unknown)`: validate/project bounded provider candidates to accountId and optional canonical Ed25519 publicKey |
| `auth-key.ts` | `resolveAuthAccount(config, subject, fetchImpl?)`: verify RPC chain, read FINAL MPC key, derive exact implicit address |
| `near-auth.ts` | `createNearAuthAdapter(config)`: official Auth0 browser SDK session check, popup login, local logout; no signer |
| `near-connect.ts` | `createNearConnectAdapter(config)`: lazy browser connector, explicit-network account reads, sign-out, detachable change signals |
| `session.ts` | `createWalletSession(network, adapters, storage?)`: one selected method/account, network-scoped hints, validated selection, subscriptions/disposal |

Pinned runtime dependencies: `@auth0/auth0-spa-js` 2.11.3, `@hot-labs/near-connect` 0.12.0 and `@scure/base` 2.2.0. Auth0 owns PKCE/state/token validation and memory token caching. The published FastAuth provider 1.4.1 and browser SDK 1.4.2 were inspected for the identity path/MPC arguments, not added with their legacy signing/mobile dependencies.

Future browser composition [I, deferred]:

1. Read only explicitly exposed `NEXT_PUBLIC_NEAR_NETWORK_ID`, `NEXT_PUBLIC_NEAR_RPC_URL` and optional `NEXT_PUBLIC_NEAR_AUTH_CLIENT_ID`; pass them to `readWalletConfig`.
2. Construct adapters on the client, never in the agent, watcher or chat Route Handler. Add hosted Auth only if `config.auth` is non-null.
3. Construct one controller for the mounted browser integration. Subscribe to `getSnapshot()` updates before `restore()`; detach/dispose on unmount.
4. Call `login(method)` directly from a user gesture; do not queue a popup behind another asynchronous operation.
5. During `connecting` or `signing-out`, competing login/restore/logout calls reject. Disable competing controls and wait for the provider operation to settle.
6. `selectAccount(accountId)` accepts only the current provider candidates. Use `session.contextKey` to partition/reset account-scoped chat, drafts and position state; it is not an authorization token.
7. `logout()` clears selected local identity immediately. An error state means remote logout was not confirmed; hosted local logout never claims to end global single sign-on.

Public configuration:

- Testnet uses the documented shared development client when no Auth client id is supplied; this does not prove the future frontend origin is allowlisted.
- Mainnet without an approved Auth client id leaves `config.auth` null; NEAR Connect can still be constructed. Passing the testnet development client as mainnet is rejected.
- Missing/invalid network or HTTPS RPC throws before connection. Browser env values are public and must never contain secrets.
- App-process environment loading remains the frontend/deployment composition root's responsibility. Adding names to `.env.example` does not inject them.

Hosted account mapping:

- The official SDK supplies validated identity `sub`, not an email, display name or client-supplied account.
- Published identity path: `jwt#https://{network Auth tenant}/#{sub}`.
- `derived_public_key` uses predecessor `fast-auth.testnet`/`fast-auth.near`, algorithm domain id `1` and the configured deployed MPC contract.
- The resolver verifies `chain_id` before sending the identity path, then bounds status/view reads with a shared deadline and response ceilings.
- Exactly 32 canonical Ed25519 key bytes become the lowercase hexadecimal implicit address. No named-account discovery, linking, account creation or funding occurs.
- This public view reveals the derivation path to the configured RPC, as the upstream SDK does. Do not log raw identity paths, claims, tokens or provider errors.

Observed evidence [V, 2026-11-08]:

- The public testnet `v1.signer-prod.testnet` view returned a valid Ed25519 key; `resolveAuthAccount` derived the expected 64-character address in **775 ms**, using a synthetic probe subject. This is deployed public-read evidence, not credential login or account existence.
- A direct runtime smoke with a labelled synthetic provider selected Bob, refused concurrent reconnect during delayed logout, cleared identity and then reconnected Alice.
- Two provider-operation regressions failed before the lifecycle correction; ten session tests passed afterward. Existing adapter tests cover malformed/wrong-chain/key results, bounded/stalled reads, cancellation, local restoration/logout and account-change rechecks.
- Independent read-only hosted-boundary review found no blocking issues. Lifecycle review found two races involving delayed SDK side effects; the reviewer confirmed both closed after the correction.
- Final workspace checks: **837 tests passed, 3 opt-in checks skipped**, typecheck/lint and production web build passed; strict OpenSpec validation passed. Production routes remained `/`, `/_not-found` and `/api/chat`, with no connection screen.

Unexercised [U]: real hosted credentials/passkey/device behavior, actual wallet approval, future origin/client allowlisting, restore under browser cookie restrictions, mainnet Auth readiness and end-to-end app login. No keys, signatures, accounts, funds or on-chain permissions were created by these checks. These gates stay with the future frontend owner; do not archive `add-dual-near-auth` as complete browser onboarding.

#### Live manual repay surface (`add-wallet-manual-repay-execution` 3.1–3.2, 2026-11-11)

Status [V, local only]: the live chat card's Execute runs `prepare (get_version + fresh position read + decode + verify) → in-app confirmation → wallet → createRepayRunner`, in the browser against `NEXT_PUBLIC_NEAR_RPC_URL` (`apps/web/src/execution/live.ts`, `wire.ts`, `useLiveRepay.ts`; `apps/web/src/play/RepayExecution.tsx`).

- The chat route serializes bigint as decimal strings. `decodeWireCard` restores only action `gas`/`deposit` and fee `amount`, and refuses anything malformed.
- Material change since the card [I, chosen rule]: debt lower than the card's, debt more than 0.1 % above it, or engine health more than 50 bps away. Each blocks with "ask for a new one".
- Never exercised with a real wallet. Live evidence is `prove-testnet-guardian-loop` 4.2.

#### Plain-wallet opening cards and chat wiring (`add-chat-open-position` 5.2, 2026-11-13)

Status [V, local only; no real wallet or browser run]: `createLiveOpening` (`apps/web/src/execution/open-position-live.ts`) wraps the runner for one live account: prepare re-reads and verifies the card, then shows the in-app confirmation (principal, fee and recipient, registration NEAR, the card's own numbers and risks, network, account); only then does one `Open wallet` click start the single wallet request. `OpeningExecution` renders it under the live card; Adjust closes the confirmation and the next card is a new chat request. After the wallet, every state shown comes from the reconciler (confirmed, partial, failed, submitted, unresolved), explorer links appear only with chain evidence, and a deposit result makes the flow line say that the deposit stays visible if no borrow is requested. A borrow card exists only for collateral Rhea already holds, because the engine quotes it from a fresh read and the runner re-matches it before signing. Server side, `quote_opening` and `propose_opening` get their inputs from `ToolContext.openingLoader`, built in `createContextLoader` from `OPENING_COLLATERAL_TOKEN_ID`, `OPENING_DEBT_TOKEN_ID`, optional `OPENING_DEFAULT_TARGET_BPS` and `OPENING_FEE_ATOMIC` (browser copies `NEXT_PUBLIC_OPENING_*`); the loader runs only when the model calls an opening tool. `createOutcomeReader` now also serves openings (it only ever used the hash and the signer). Permission boundary: unchanged, the signer accepts only what the verifier issued (OP-1) and a card is single-use (OP-4). Negative tests: `open-position-live.test.ts` (18), `opening-execution-ui.test.ts` (14), loader tests in `opening-tools.test.ts` and `chat-context.test.ts`, all mutation-checked; one equivalent mutant (the store's signer check, which the runner repeats). Does not guarantee a faithful wallet display, exact delivery, or that the position still matches when the wallet confirms; no Playwright or real-wallet run exists yet.

#### Plain-wallet opening execution (`add-chat-open-position` 4.1 to 4.3, 2026-11-13)

Status [V, local only; the cards now render it, see the next section]: `createOpeningRunner` runs one stage of one card as fresh read, `verifyOpeningPayload`, card re-match, wallet, then receipts plus a fresh post-state through `reconcileOpening`. Permission boundary: only a NEAR Connect session signs, only what the verifier accepted against a context read just before (OP-1); a card is locked from the moment signing starts and never unlocked, so a stage is submitted at most once per card (OP-4); `check` is read-only. Invariant OP-5: `confirmed` exists only with parsed FINAL receipts plus a post-state read; acceptance alone is not collateralization, a balance delta is not proof of delivery, debt without delivery is partial and the debt stays, and nothing is rolled back or charged again. Negative tests: `open-position-run.test.ts` (56), `open-position-reconcile.test.ts` (28) and the parser suite, with real recorded Gate 1 evidence. Does not guarantee cross-stage atomicity, that an observed change was caused by this transaction rather than concurrent activity, exact delivery, or a faithful wallet display.

#### Plain-wallet opening outcomes (`add-chat-open-position` 4.1, 2026-11-13)

Status [V, local only]: `parseOpeningOutcome` reads each planned transaction from raw `EXPERIMENTAL_tx_status` evidence and judges every receipt, so a root that succeeded with a failed receipt below it (the recorded USDC borrow) is failed. Evidence per role: a deposit needs the lending contract's `ft_on_transfer` and the token's `ft_resolve_transfer` for the accepted and refunded amounts; a borrow needs the debt token's `ft_transfer` to the signer and Rhea's `after_ft_transfer` returning `true`; a balance delta is never causal proof. `fixtures/rhea/opening-outcomes.json` holds five real testnet transactions (demo user, Rhea `0.11.0`, fixed prices) recorded from `https://archival-rpc.testnet.near.org`; other branches are labelled mutations of them. Permission boundary: read-only, no signer. Invariant OP-5 is only partly covered: confirmation also needs fresh post-state, which is the next stage. Does not guarantee cross-stage atomicity, exact delivery or isolation from concurrent activity.

#### Plain-wallet opening verification (`add-chat-open-position` 3.2 and 3.3, 2026-11-13)

Status [V, local only]: `verifyOpeningPayload` in `apps/web/src/execution/open-position-verify.ts` is the browser-side gate for the future deposit and borrow cards; nothing renders or executes them yet (tasks 4 and 5). Permission boundary: only the connected NEAR Connect wallet signs, and `createTransactionSigner` accepts an opening only if this verifier issued it for that account and network (OP-1). It allows exactly: bounded registrations the fresh context says are missing, a 1-yocto collateral `ft_transfer_call` with only `IncreaseCollateral`, or `execute_with_pyth` with one `Borrow` and a `Withdraw` that has no amount, plus an optional fee. Invariants: OP-1 (only verified calls to configured lending, tokens and fee recipient reach the signer) and OP-2 (displayed and payload amounts are one number; an amount-omitted action never runs against an account that already supplies the token). Negative tests: `apps/web/test/open-position-verify.test.ts`, 66 tests and 28 guard mutations. Does not guarantee: a faithful wallet display, Rhea accepting the action, or an unchanged context at inclusion; gas floors are the probe's 240 Tgas and the 100 Tgas transfer default, not measured minimums.

#### Live Guardian activation and controls (`add-guardian-live-activation-ui`, 2026-11-11)

Status [V, local only]: implemented and tested against fake RPC clients and recorded-shape views; never run against a deployed factory (none exists, SMART-CONTRACT "Not deployed"). Live evidence belongs to `prove-testnet-guardian-loop` 4.3.

| Module | Contract |
| --- | --- |
| `apps/web/src/guardian/config.ts` | `readGuardianConfig`: network, HTTPS RPC, factory id and per-action fee; missing values block setup |
| `apps/web/src/guardian/verify.ts` | `verifyGuardianPayload(payload, intent, expectation)`: exact builder output per intent, frozen and branded result |
| `apps/web/src/guardian/flow.ts` | `nextActivationStep`, `activationProgress`, `buildActivationStep`, `buildControl`: steps and payloads from chain state only |
| `apps/web/src/guardian/controls.ts` | `controlAvailability`, `inFlightNotice`, `historyNotice`, `heartbeatState` |
| `apps/web/src/guardian/live.ts` | `createLiveGuardian`: block-pinned reads and the `build → verify → wallet → re-read` pipeline |
| `apps/web/src/guardian/loan.ts` | Guardian-held loan (task 5.5): `readHoldings` (Rhea `get_account` and `ft_balance_of` views; collateral rounded down, debt up), `loanAvailability`, `buildLoanStep`, before/after `LoanOutcome` |
| `packages/guardian-client/src/tx/position.ts` | `guardianPositionPayload`: collateral `ft_transfer_call` with `{"collateral":{}}`, `owner_borrow`, `owner_sweep`, each 1 yocto and 300 Tgas (the sandbox flow's attachment) |
| `apps/web/src/play/LiveGuardianPanel.tsx` | Setup form, review, the three activation steps and the panel with controls and the Loan section for a live wallet session |

Money path:

- Permission boundary: only the owner's NEAR Connect wallet signs. `createTransactionSigner` accepts only `VerifiedRepay` or `VerifiedGuardian` results, and the Connect adapter's signing surface is registered in `near-connect.ts`, so the session controller and React context stay signer-free. NEAR Auth sessions can view but not sign.
- Invariants: G-UI-1 (verified payloads to the factory, own Guardian or debt token only), G-UI-2 (summary numbers equal payload numbers), G-UI-3 (a Guardian is shown only after the factory reports it), G-UI-4 (progress from chain reads). SMART-CONTRACT I1 to I10 stay contract-enforced.
- Negative tests: `guardian-verify.test.ts`, `guardian-live.test.ts` and `live-guardian-panel.test.ts` (AddKey, wrong factory, policy drift, non-owner signer, hash-only creation, wallet error, in-flight withdraw, deactivated controls, Auth session).
- Loan steps (task 5.5, user decision 2026-11-11): only for an activated Guardian with nothing in flight. The verifier accepts the configured collateral token's `ft_transfer_call` to the own Guardian (≥ 180 Tgas, `{"collateral":{}}`), own-Guardian `owner_borrow` (≥ 260 Tgas) and `owner_sweep` for the configured debt or collateral token, each with 1 yocto; negative tests in `guardian-loan.test.ts` (other token, receiver, message, Guardian or sweep token, 2 yocto, low gas, changed amount, extra argument, in flight, before activation, non-owner), each guard mutation-checked. Outcomes compare two chain reads; hashes appear only after a change is observed. The Guardian client allowlist gains the read-only views `get_account` and `ft_balance_of`. A borrow shows no computed health factor; Rhea refuses one that leaves the position unhealthy or lacks fresh prices.
- Limits edit (2026-11-14): an owner of an active or paused Guardian with nothing in flight can change max per action, max total, reserve floor, trigger, target and cooldown. `parsePolicyForm` applies the creation rules plus the contract's `lifetime_cap >= spent_total` and keeps the per-action fee the Guardian already runs with; the review lists only what changes as "old → new". The verifier accepts only own-Guardian `set_policy({policy})` with 1 yocto whose policy is byte-equal to the reviewed one, and the panel then shows the chain's policy, never the wallet's answer. Negative tests in `guardian-policy.test.ts`: changed trigger or max per action, extra argument, other receiver, 2 yocto, other signer, Guardian not yet active, operation in flight, wrong intent; deleting the byte-equality check fails two of them. Does not guarantee that the watcher acts under the new limits or that a repay succeeds. Before this existed, `set_policy` ran by script from the owner's key on testnet (the demo Guardian's trigger 120% → 200%, 2026-11-14).
- Does not guarantee: that the watcher acts (no heartbeat source is connected, so it shows as unavailable), that a step succeeds, that a refund covers gas, or that the Guardian's NEAR can be withdrawn. Creation funding is the factory `min_funding`. The user chose P0 UI for collateral deposit, borrow and sweep on 2026-11-11; these controls are not yet implemented (task 5.5).

### 6. NEAR AI Cloud (B6, P0.6)

Docs: https://docs.near.ai/cloud/guides/openai-compatibility.md ; https://docs.near.ai/cloud/models.md ; https://docs.near.ai/cloud/quickstart.md ; credit request link on https://docs.near.org/getting-started/hackathons.md (read 2026-11-04).

Human setup [V, resolved locally 2026-11-08]: the user supplied the key and selected GLM for implementation; keep `NEARAI_API_KEY` only in ignored local environment or the deployment secret store. No account creation, login or credit purchase was performed by this change.

Exercised: the official `GET https://cloud-api.near.ai/v1/models` listed `Qwen/Qwen3.8-27B` and `z-ai/glm-5.3-flash`, both supporting tools. The GLM pricing snapshot was refreshed at `2026-11-08T03:41:46.962164+00:00`; authenticated declared-tool completions and three-language local HTTP requests succeeded. Qwen inference/comparison was not performed.

Remaining agent gate (owner: lead): obtain passing P3.4 live evaluation and independent review before resolving D25. Four complete GLM runs, a separate two-case diagnostic and the completed assistant review (22 content/honesty approvals, 14 rejections) are documented in CHAT-API; none establishes acceptance. Privacy wording must match the chosen model's tier (own TEE, third-party TEE or provider-hosted); local access alone proves no retention/privacy guarantee.

### 7. Contract toolchain (P0.3, Phase 2)

Docs: https://github.com/near/cargo-near ; https://github.com/near/near-workspaces-rs ; https://github.com/near/near-sdk-rs (read 2026-11-04).

Agent steps (planned): install Rust 1.99.1 with the `wasm32-unknown-unknown` target; install `cargo-near` 0.22.0 from its release (do not pipe unpinned installer scripts); run sandbox tests on Linux or WSL2 (the sandbox does not support native Windows). Verification: `cargo near --version` prints 0.22.0; `cargo test` in `contracts/tests` starts a sandbox.

### 8. Watcher host (B8, P5.3)

After D16: Option A deploys `apps/watcher` as an always-on process (Railway or Fly.io); Option C uses Worker Cron. Human: create the account and approve the cost. Agent: deploy with approval, set environment variables, confirm the heartbeat endpoint or log line updates every polling interval.

### 9. NEAR Intents (future only)

Official docs say there is no testnet (`intents.near` only). A community sandbox, Tidepool (`https://www.usetidepool.tech`, verifier `verifier.tidepool-sandbox.testnet`), was reachable on 2026-11-04 and disclaims any affiliation; it has its own custody model. Nothing is built or claimed (D13).

## Skills: provenance, installation and restore

Project skills are **committed** in `.claude/skills/` (founder decision D21). `skills-lock.json` pins each upstream revision and content hash. License texts and notices: `.claude/skills/LICENSES/`. Read a skill's `SKILL.md` before using it; task authorization in CLAUDE.md always outranks a skill's own instructions (several ask for commits, full-suite runs or installs).

| Skill | Upstream owner / repository | Revision | License | Why needed | Installed path |
| --- | --- | --- | --- | --- | --- |
| writing-plans | obra / https://github.com/obra/superpowers | `22f0b463e7a5e579904dd6211a520321035526f7` | MIT | Exact task plans with interfaces and tests | `.claude/skills/writing-plans/` |
| test-driven-development | obra / superpowers | same | MIT | Red-green for engine math and contract invariants | `.claude/skills/test-driven-development/` |
| systematic-debugging | obra / superpowers | same | MIT | Root-cause RPC, callback and receipt failures | `.claude/skills/systematic-debugging/` |
| verification-before-completion | obra / superpowers | same | MIT | Evidence before any "done" claim | `.claude/skills/verification-before-completion/` |
| requesting-code-review | obra / superpowers | same | MIT | Independent review of money paths | `.claude/skills/requesting-code-review/` |
| codebase-design | mattpocock / https://github.com/mattpocock/skills | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | MIT | Deep modules and small interfaces for engine, adapter and policy | `.claude/skills/codebase-design/` |
| near-smart-contracts | near / https://github.com/near/agent-skills | `cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b` | MIT (skill frontmatter) | Guardian and factory in Rust near-sdk | `.claude/skills/near-smart-contracts/` |
| near-contract-audit | near / agent-skills | same | none declared (B10) | Pre-release review checklist for the Guardian | `.claude/skills/near-contract-audit/` |
| near-api-js | near / agent-skills | same | none declared (B10) | RPC reads and service signing | `.claude/skills/near-api-js/` |
| near-dapp | near / agent-skills | same | none declared (B10) | Wallet connection with NEAR Connect | `.claude/skills/near-dapp/` |
| near-ai-cloud | near / agent-skills | same | none declared (B10) | NEAR AI Cloud client and model tiers | `.claude/skills/near-ai-cloud/` |
| motion | motiondivision / https://github.com/motiondivision/ai-kit | `1e424943582cbbdb6e3f410687e39f96451447bb` | MIT declared in `packages/motion-ai/package.json`; no repository LICENSE (B10) | UI and character motion with `motion/react` | `.claude/skills/motion/` |

Review results (2026-11-04, read before install): no secret collection found. Notes that bind usage:
- `near-smart-contracts` contains `curl | sh` installers, forced `cargo near new`, and account creation and deploy commands. Never run them without the task's explicit authorization; use pinned tool versions.
- `near-api-js` contains private-key and seed examples. User signing always goes through the wallet; the only server-side key is the watcher's function-call key.
- `motion` points to a hosted MCP and paid Motion+ features; copying the skill configures neither.
- `systematic-debugging` examples inspect secret presence; redact logs and never touch user keys.

Install commands used (exercised 2026-11-04, CLI `skills@1.7.6`, Node 24.21.0, telemetry disabled with `DISABLE_TELEMETRY=1`):

```bash
npx --yes skills@1.7.6 add "https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills/<name>" -a claude-code --copy -y -s <name>
npx --yes skills@1.7.6 add "https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/codebase-design" -a claude-code --copy -y -s codebase-design
npx --yes skills@1.7.6 add "https://github.com/near/agent-skills/tree/cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b/skills/<name>" -a claude-code --copy -y -s <name>
npx --yes skills@1.7.6 add "https://github.com/motiondivision/ai-kit/tree/1e424943582cbbdb6e3f410687e39f96451447bb/plugins/motion/skills/motion" -a claude-code --copy -y -s motion
```

Restore (exercised 2026-11-04): the skills are already in git, so a clone needs nothing. To verify or rebuild them from upstream:

```bash
DISABLE_TELEMETRY=1 npx --yes skills@1.7.6 experimental_install   # restores into .agents/skills/ (gitignored), hash-checked against skills-lock.json
diff -rq .agents/skills .claude/skills                              # expected: no output (identical)
```

Observed: 12 skills restored, `diff -rq` reported no differences. `experimental_install` writes to `.agents/skills/`, not `.claude/skills/`; copy from there only if a committed skill is damaged. To update a skill: re-run its `add` command with a newer reviewed revision, review the diff, and commit the folder and `skills-lock.json` together. The CLI requires Node ≥ 22.20.0.

| Skipped candidate | Reason / evidence |
| --- | --- |
| executing-plans (obra/superpowers) | Depends on sibling scripts (`subagent-driven-development`) that a single-skill copy does not include; would be broken |
| brainstorming (obra/superpowers) | Product scope is decided; optional visual server loads an external image and spawns processes |
| code-review (mattpocock/skills) | Duplicates requesting-code-review; assumes tracker setup |
| near-kit, near-intents, near-cli-rs (near/agent-skills) | Second SDK, out-of-scope cross-chain swaps (D13), operator CLI with key export commands |
| gsap-core, gsap-react (greensock/gsap-skills, MIT, `aed9cfd3277740755f6bfc1155c7aa645403b760`) | Clean, but GSAP and Motion are alternatives; install only if D26 picks GSAP |
| impeccable (pbakaus/impeccable, Apache-2.0, `2c95b1968ca74c5d2c4c0503dcee72f6d0d555ea`) | Downloads and runs a native engine; its live-copy feature launches agents with approval and sandbox bypass flags. Too much unattended authority for a finance codebase; reconsider for P4.4 with live-copy disabled |

## Agent tooling configuration

Each developer's agent configuration (model routing, worker limits, personal tool settings) is personal and stays out of the repository (`.omp/` is gitignored; D17). `CLAUDE.md` holds the only shared agent rules.

## Manual actions and blockers

1. Founder: decide outstanding D19 from Phase 0 evidence; D16 Option A and D18 G1 are already resolved.
2. Lead: resolve D25/P3.4 with passing full live evidence and recorded independent review; B6 local API access is resolved (2026-11-08).
3. Founder or authorized lead: testnet accounts (B7) before P0.2.
4. Founder: watcher host account (B8) after D16.
5. 0xlann: team list and other entries (B9) before P6.3.
6. Founder: accept or remove the five skills without a clear license (B10) before the repository is made public.
