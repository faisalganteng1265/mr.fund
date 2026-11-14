# Watcher sandbox operator test

The watcher's public path runs on Linux, macOS or WSL2 only. The journal
requires directory `fsync` for durability, and both the journal and key loader
require `O_NOFOLLOW` to reject symlinks. Native Windows cannot provide these
guarantees through the Node filesystem APIs used here. Use a private,
persistent filesystem directory on the supported host; WSL2 means Linux
processes and a Linux filesystem, not native Windows Node.

The sandbox-only operator exercises `requestOverLimit` outside the polling loop.
Run it through the disposable contract harness from the repository root, after
installing workspace dependencies and preparing the contract sandbox artifacts:

```sh
cargo test --manifest-path contracts/Cargo.toml -p contract-tests --test probe probe_testnet_wasm_cycle -- --nocapture
cargo test --manifest-path contracts/Cargo.toml -p contract-tests --test probe probe_mainnet_wasm_cycle -- --nocapture
```

Each run starts a local sandbox, deploys fixtures with simulated prices, and
creates a new disposable watcher function-call key for each Guardian. The harness
passes the key to `apps/watcher/src/sandbox/operator-cli.ts` on stdin; it is not
printed or persisted by the operator. The operator accepts only a loopback HTTP
endpoint and a sandbox `test-chain-*` chain id, checks that the key permits only
`request_repay` on the selected Guardian, checks a fresh Guardian snapshot and
submits one `max_per_action + 1` request with zero deposit. It prints the signed
hash as a pending result. The harness resolves that hash and verifies the
rejection event, history, unchanged debt and reserve, then submits an in-limit
request using the same scoped key. Output is sandbox evidence only.
The operator uses a dedicated sandbox-scoped journal directory supplied by the
harness. After resolving the first request, the harness starts a second operator
process with the same journal and verifies it refuses and creates no second
history entry. The disposable test directory is removed only by the harness.
The sandbox adapter derives its clock offset from the local final block because
the harness can advance simulated time. Public freshness checks use wall time.
Transient sandbox authority reads receive bounded retries before signing; a
signed transaction or broadcast is never retried automatically.

The command `pnpm --filter @mrfund/watcher sandbox:over-limit` is the underlying
explicit entry point; it expects the harness's JSON on stdin and must only be used
with a newly created disposable sandbox key. Do not use a public or existing key.
The sandbox journal persists across invocations while its directory exists; an
uncertain submission must not be retried. Public operation requires independent
reconciliation and the D18/D19/B7 gates; the normal watcher remains read-only.

To inspect the configured public network and scoped key without signing or
sending, run `pnpm --filter @mrfund/watcher operator:preflight <guardian-id>`
with the same `NEAR_NETWORK_ID`, `NEAR_RPC_URL`, `WATCHER_ACCOUNT_ID` and
`WATCHER_KEYS_DIR` configuration as the watcher. The command exits nonzero and
reports `read_only`, including when the key is valid: current chain views and a
key nonce do not prove that an earlier signed transaction cannot still arrive.
Errors are sanitized and never include key material or RPC details. This is a
preflight only; it does not authorize submission.

## Explicit public testnet operator

[I, implemented locally; no public request exercised] After the public proof
gates and explicit authorization, use `pnpm --filter @mrfund/watcher
operator:over-limit <guardian-id> --dry-run --confirm-exclusive-key
--confirm-prior-requests-reconciled --confirm-persistent-journal`. Replace
`--dry-run` with `--execute` only for the authorized operator test request.
Set the existing watcher environment variables and
`WATCHER_OPERATOR_JOURNAL_DIR` to an absolute, owner-only, persistent Linux
directory shared by every process that can use that Guardian's watcher key.
Dry-run checks authority, Guardian readiness and the empty journal without
creating a record, signing or sending; it still performs public RPC reads.

The three confirmations are operator attestations, not facts inferred from the
key nonce or filesystem. The exclusive scoped key must have been controlled
by this journal since provisioning, and all prior signed requests independently
reconciled; a newly empty directory proves neither. Persistence across host
loss cannot be verified from a directory mode. Never delete, replace or move a
journal to permit another attempt. A synchronized intent precedes signing; the
hash is synchronized before the single broadcast. Restart with a recorded hash
only looks up its final outcome; an incomplete intent blocks signing. A missing,
failed or mismatched final event/history remains ambiguous, not success.
The label is operator output only: the existing Guardian history ABI has no
field that identifies why a watcher invoked the request. Consumers must not
infer an on-chain operator-test label from the rejection alone.

Permission boundary: a finite-allowance watcher function-call key may call only
`request_repay` on the selected Guardian, with zero deposit. Guardian invariants
I1–I8 remain the contract boundary. Negative tests cover broad keys, stale or
paused state, in-flight/cooldown, journal reuse and ambiguous sends. This does
not guarantee transaction finalization, repayment, uptime, or protection from
liquidation. The scheduled public watcher is read-only unless started with the single-request flags (INTEGRATIONS "Watcher local runtime").

Allowance: the scoped key's allowance must exceed the prepaid gas cost. A 0.25 NEAR key failed to carry a 300 Tgas request on testnet (cost about 0.30 NEAR, LESSONS 2026-11-13); the evidence run used 1 NEAR. The operator reports `ambiguous` when it looks the hash up before finality; run the same command again and, with a recorded hash, it only looks that hash up.

[V, testnet, 2026-11-13] The operator was exercised once publicly: a rejected over-limit request (op 8) on Guardian `db96d75c…f2-mrf-b1ce96af6a.testnet`. Evidence and limits: SMART-CONTRACT "Public negative tests on the first Guardian".
