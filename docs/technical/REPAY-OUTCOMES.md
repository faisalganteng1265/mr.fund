# Repayment outcome interpretation

[V, local implementation, 2026-11-07] P4.3's backend parser is implemented in `packages/rhea/src/outcome*.ts`. Wallet connection, signing, receipt UI and public wallet proof remain separate unchecked work. No function in this API can sign, send or retry a transaction.

## API and authority

- `RepayPlan`: configured network/account/lending/token/version and the ordered submitted transaction plan. Each `ExpectedTransaction` carries a known hash, signer, receiver, method, exact unsigned `argsJson`, deposit and role (`repay`, `fee`, `registration`). There must be one repay, with fees after it. Hashes and payloads come from trusted application/wallet plumbing, never from model arguments or RPC results. This API consumes known hashes; wallet cancellation/unsubmitted steps remain the wallet integration's responsibility.
- `parseTransactionOutcome(evidence, expected, plan)`: pure validation of a raw `EXPERIMENTAL_tx_status` result and its block headers. Binds the transaction, initial action receipt, token receiver call and resolver to the expected transfer; traverses every reachable outcome, including native refund receipts. Duplicate ids, cycles, altered identities, malformed UTF-8/base64/u128, contradictory returns and used amounts above the request refuse with a typed error. Missing data/finality stay pending.
- `parseRepayOutcome(evidences, plan)`: ordered aggregation. Missing later evidence remains pending while preserving prior applied results. A successful repay followed by a failed fee is partial. An ineffective full refund is failed, even if the top-level return is `SuccessValue`.
- `createOutcomeReader(rpcUrl, network, fetchImpl?)`: read-only RPC adapter. Checks `status.chain_id`, requests `EXPERIMENTAL_tx_status` with `wait_until: FINAL`, then obtains block headers for all execution outcomes. It does not guess methods or retry. Unknown transactions return null evidence; other RPC/provider failures are sanitized typed errors.
- `readRepayOutcome(plan, reader, options)`: one bounded lookup/post-read pass. Defaults: 15-second total deadline, 120-second observation age. It retains earlier successful results when another lookup times out. Injected readers receive an abort signal; even a non-cooperative reader cannot keep the orchestration pending indefinitely.
- `toCardReceipt(result, atMs)`: maps verified structured evidence to the existing shared receipt schema. Rich execution diagnostics remain on `RepayOutcome`, rather than being hidden in prose or invented UI fields.

The configured RPC is the read trust boundary; this is not a cryptographic inclusion-proof verifier. Maximums are 16 planned transactions, 512 receipt outcomes, 64 graph levels, 65536-character text fields and 2 MB per RPC response. The RPC reader also has a 10-second read deadline. Missing receipt payloads, incomplete block evidence, or an RPC that cannot expose the first receipt produce pending results rather than assumed success.

Both verified lending versions (0.11.0, 0.16.2) use the recorded NEP-141 resolver return as **used/accepted token units**, not debt paid. Unknown lending versions refuse. Transaction methods, arguments and deposits are matched against the already validated unsigned request; this parser is not a replacement for the version-aware payload builder.

## Execution, money and observations

Malformed or mismatched later evidence still returns a typed error; `OutcomeError.observedTransactions` preserves previously validated transaction effects. Consumers must retain these diagnostics and must not reset an already applied repay to an untouched draft because its later fee lookup failed validation.

`TransactionOutcome` keeps `sent` (the requested outer atomic amount), `accepted`, `refunded`, reached failure receipt ids, pending reasons and initial/final block heights. Before resolver evidence exists, accepted/refunded remain null; a failed initial transfer does not fabricate a refund. Accepted + refunded comes from the matched resolver, not Rhea event text or the top-level success flag alone.

All amounts use bigint. Rhea debt/supplied observations remain **internal units**, distinct from token atomic units. Transport consumers must serialize these explicitly as decimal strings, without conversion to Number.

`ObservationReader` must provide a final-block position read and preserve the read's start time. Reconciliation checks:

1. Network, lending id, account and target token metadata match the trusted plan and baseline; decimals cannot change silently.
2. The baseline block is strictly before transaction inclusion; the post-state block is at/after every final outcome block, including fees/refunds.
3. Both snapshot times are non-future and within the configured age, with before/after read times ordered.
4. Balances are bounded nonnegative bigint values. Missing/invalid/stale observations remain null without discarding final execution evidence.

Debt reduction and supplied surplus are observed deltas, **not causal attribution**: interest, concurrent actions or price changes may intervene. Health values come only from an optional trusted engine callback injected by the composition root; `rhea` never imports the engine at runtime. An engine refusal omits health, without fabricating a value or discarding valid balance observations.

| Execution / observations | CardReceipt status |
| --- | --- |
| Any transaction unresolved | `submitted` |
| No effective terminal success, including full refund | `failed` |
| Mixed effects/failures or partial refund | `partial` |
| Entire transfer batch succeeds but post-state is unavailable | `submitted` (execution remains separately terminal) |
| Entire batch succeeds, but valid post-state shows no debt decrease | `partial` |
| Entire batch succeeds and fresh post-state shows debt decrease | `confirmed` |

The character cannot become pleased from token acceptance alone. `healthBeforeBps`/`healthAfterBps` are set only from checked snapshot engine results; failed/partial receipts still take the engine's concerned branch. Full repayment's `no_debt` is preserved, not converted into an invented infinite health number.

## Composition example

The application constructs `plan` and captures `before` from trusted data. It can compose the existing adapter and deterministic engine as follows:

```ts
import { healthBps } from "@mrfund/engine";
import { createOutcomeReader, createRheaClient, readPosition, readRepayOutcome, toCardReceipt } from "@mrfund/rhea";

const result = await readRepayOutcome(plan, createOutcomeReader(rpcUrl, plan.network), {
  before,
  observer: {
    readPosition: (signal) => readPosition(
      createRheaClient(rpcUrl, (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
      })),
      { network: plan.network, lendingId: plan.lendingId },
      plan.accountId,
    ),
    health: healthBps,
  },
});
if (result.ok) {
  const receipt = toCardReceipt(result.value, Date.now());
  // Keep result.value's per-transaction diagnostics alongside the receipt.
}
```

Permission boundary: public configured reads and unsigned-plan validation only; no signer/key imports. Invariant O1: confirmed repayment and health improvement cannot derive solely from token acceptance. Negative tests cover altered plan identities, unrelated resolvers, receiver/executor mismatch, missing/finalizing/cyclic graphs, malformed amounts, stale/mismatched blocks, post-read failure/deadline and concurrent debt increases. This does not reverse partial execution, prove liquidation protection or attribute a before/after change solely to the transaction.

## Browser composition

`apps/web/src/execution/run.ts` composes this module in the browser: `verifyCardPayload` → fresh `before` read → Connect-only signer → `assembleRepayPlan` (hashes only from the wallet's `FinalExecutionOutcome[]`, paired in order after signer/receiver checks, then `validateRepayPlan`) → `readRepayOutcome` → `toCardReceipt`. A reader error keeps the receipt `submitted` with an explicit Check again; there is no polling loop. A wallet error or a mismatched wallet result skips plan assembly and decides by re-reading the debt. `@mrfund/rhea` and `@mrfund/shared` import no Node-only module, so outcome reading runs in the browser against the configured public RPC (test-enforced). The recorded full-refund and detached-failure requests use messages no builder emits, so the browser verifier refuses them before signing.

## Recorded evidence and reproduction

[V, local sandbox] `fixtures/outcomes/` contains six scenarios for each imported Rhea version: successful repay, supplied surplus, full refund, partial-refund fixture receiver, Rhea action failure with successful top-level return, and failed fee. A batch test composes the sequential successful repay and failed fee recordings. Each file preserves the actual raw RPC graph, block headers, original request and before/after Rhea account views, plus source WASM provenance, recording time and receiver-fixture WASM hash. All prices are **Simulated**; the pure replay test namespace is `testnet`, while the provenance identifies the imported source network. These are local accounts/state, not public testnet or mainnet transactions.

Partial-refund recordings use the explicitly sandbox-only receiver in `contracts/tests/fixtures`; they demonstrate NEP-141 mechanics, not a claim that Rhea refunds rounded repay surplus. Real imported Rhea repayments in these recordings accept the rounded excess as supplied balance. A strict over-repayment action fails while the top-level return remains successful with used = 0; receipt traversal catches the failure.

Fresh-clone preparation: `pnpm contracts:probe:prepare`. To regenerate the tracked recordings, run `RECORD_OUTCOMES=1 cargo test --manifest-path contracts/Cargo.toml -p contract-tests --test probe`. Ordinary contract tests write their new captures under ignored `contracts/target/probes/outcomes/`, preserving committed historical fixtures. Never hand-edit recorded RPC responses or show them as live data.

Tests: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm contracts:test`, and `cargo clippy --manifest-path contracts/Cargo.toml --all-targets -- -D warnings`. Dated run summaries live in BUILD-PLAN P4.3.

RPC semantics reference: [NEAR transaction status and finality](https://docs.near.org/api/rpc/transactions), checked 2026-11-07. Requesting `FINAL` and validating the returned field are both required; optimistic execution is not settlement evidence.
