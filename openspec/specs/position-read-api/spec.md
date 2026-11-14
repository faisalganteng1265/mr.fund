# position-read-api Specification

## Purpose

Independent public read-only `/api/position` GET/POST interface that reuses the unchanged Rhea, shared and engine functions. Archived from change add-position-read-api.

## Requirements

### Requirement: Validated network-qualified public requests

[I, proposed] The server SHALL expose GET and POST `/api/position` with the request shapes in design.md, validate account syntax with shared `isValidAccountId`, reject unknown/duplicate fields and require client `networkId` to match explicit server configuration. The client SHALL NOT choose the RPC, lending contract or protocol version. The server MUST verify RPC chain identity before position reads; implicit ids MUST be interpreted only on the explicitly selected network.

#### Scenario: Malformed account

- **WHEN** an account is uppercase, malformed, too long or presented as a URL
- **THEN** the handler returns HTTP 400 `invalid_input` before any RPC call

#### Scenario: Wrong-network named account

- **WHEN** a mainnet request supplies a `.testnet` account, a testnet request supplies a non-testnet named account, or client network differs from server
- **THEN** the handler returns HTTP 409 `network_mismatch` before position reads

#### Scenario: Misconfigured RPC chain

- **WHEN** the configured RPC reports a chain_id different from the server network
- **THEN** the handler returns `network_mismatch` and performs no position views

#### Scenario: Network-neutral implicit account

- **WHEN** a canonical 64-hex account is supplied with matching client/server network and RPC chain
- **THEN** it is read on that network only and no account existence or ownership is inferred from its syntax

### Requirement: Shared protocol and engine foundations

The handler SHALL share chat's `createRheaClient`/`readPosition` boundary and reuse engine `healthBps`, `liquidationPrice`, `outstandingDebtAtomic` and shared `toAtomic`/`usdPerWholeToken`. The loader MUST verify lending version at the snapshot anchor hash. Unsupported versions MUST refuse without retry/fallback. Reads MUST require no LLM key, fees or factory configuration.

#### Scenario: Same input as chat

- **WHEN** a fake RPC supplies identical validated snapshot data and a fixed clock to chat's position tool and the HTTP read
- **THEN** corresponding health, debt and liquidation values agree exactly and the HTTP path never invokes inference

#### Scenario: Version-specific testnet constraint

- **WHEN** the fake RPC reports supported 0.11.0 testnet read data or supported 0.16.2 mainnet read data
- **THEN** the route validates each read schema without assuming the versions have interchangeable write encodings

#### Scenario: Unknown version

- **WHEN** pinned get_version returns a well-formed unsupported version
- **THEN** the route returns HTTP 422 `unsupported_protocol_version` without a position success or another-version retry

### Requirement: Exact conservative position representation

The response SHALL implement the successful wire shape in design.md, including exact decimal-string internal and atomic lending balances, token units, prices, APR basis points, engine inputs and assumptions. Money MUST NOT be encoded as floating-point numbers. Supply/collateral atomic values SHALL floor, debt atomic values SHALL ceil, health SHALL floor using internal balances, and liquidation prices SHALL use the engine's upward rounding. Unknown metadata MUST NOT become zero debt.

#### Scenario: Subatomic debt and large balances

- **WHEN** fixtures include balances above 2^64 and debt with nonzero subatomic remainder
- **THEN** strings retain every internal digit, debt atomic units round up and supply/collateral round down without Number conversion

#### Scenario: Debt-free supplied position

- **WHEN** an account has positive lending supply or collateral and zero debt
- **THEN** the response represents health and liquidation status as `no_debt`, never infinity or invented prices

#### Scenario: Other collateral covers the loan

- **WHEN** the engine returns a zero liquidation multiplier for one collateral token
- **THEN** the response identifies `covered_by_other_collateral` instead of displaying a zero market price

### Requirement: Honest source freshness and network identity

Every successful response SHALL include `provenance: "live"`, accountId, networkId, Rhea lending id/version, block hash/height, read/computation timestamps, engine data age and its limit. Fixed protocol prices MUST retain `default_price` and null publish time; derived liquidation values MUST NOT invent oracle timestamps. The response contract SHALL require browser consumers to discard account/network mismatches and superseded reads. Fixtures MUST NOT be loaded by the production route.

#### Scenario: Fixed-price public data

- **WHEN** a current RPC read uses a protocol default_price
- **THEN** the source remains explicit, fixed-price assumptions remain visible and live provenance describes the RPC read rather than a moving market price

#### Scenario: Wallet network changes

- **WHEN** the browser's current wallet network differs from response networkId
- **THEN** that response is ineligible for the current position display; this backend change does not claim UI wiring exists

#### Scenario: Stale snapshot or price

- **WHEN** the snapshot or an engine-required price exceeds the configured age limit
- **THEN** HTTP 422 `stale_data` contains no current health or successful position view

#### Scenario: Missing or untrusted source

- **WHEN** a required price is null, asset metadata is unavailable, blocks are mixed or source data is malformed/future-dated beyond engine tolerance
- **THEN** HTTP 502 `untrusted_data` replaces the live position success, without fixture fallback

### Requirement: Stable sanitized error outcomes

Errors SHALL use the stable HTTP/code mapping and error envelope in design.md, with static English recovery-oriented messages and no secrets, stack traces or raw provider errors. No-position outcomes MUST be distinguished from RPC failures and from a debt-free nonempty position.

#### Scenario: Unregistered account

- **WHEN** get_account returns null or every lending balance is zero
- **THEN** HTTP 404 `no_position` is returned without inventing a loan or asserting the NEAR account itself is absent

#### Scenario: RPC failure

- **WHEN** RPC transport or HTTP fails
- **THEN** HTTP 503 `rpc_unavailable` is returned and is not reported as an empty account

#### Scenario: Sensitive downstream failure

- **WHEN** a thrown downstream error contains a key, credential URL or stack trace
- **THEN** the response contains only the stable sanitized error and configured network identity

### Requirement: Bounded cancellable uncached reads

The handler SHALL enforce design.md's 15000 ms total/10000 ms RPC deadlines, cancellation, 4 MiB RPC ceiling, 1024-byte body/512-byte query limits, and 30-per-60000 ms transport/account quotas with at most 4096 buckets. Unauthenticated forwarding headers MUST NOT bypass admission. Reads/responses SHALL be no-store with no cross-request cache, hidden retries or alternate-network fallback.

#### Scenario: Stalled or cancelled body

- **WHEN** request or RPC body streaming stalls past its deadline or the caller aborts
- **THEN** reading is cancelled, no later views start, resources are released and the available response is `timeout` or `cancelled` as appropriate

#### Scenario: Oversized request

- **WHEN** a chunked POST exceeds 1024 bytes despite its declared Content-Length or a query exceeds 512 bytes
- **THEN** HTTP 413 `request_too_large` is returned before snapshot work

#### Scenario: Rate limit and spoofed forwarding

- **WHEN** the quota/capacity is exhausted or an unauthenticated client changes X-Forwarded-For
- **THEN** admission returns HTTP 429 with Retry-After or retains the same direct-client bucket, respectively

#### Scenario: Refresh after repayment

- **WHEN** another admitted request follows an earlier response
- **THEN** the handler performs a new final-block read rather than serving an undisclosed cached position

### Requirement: Read-only authority and qualified evidence

The route MUST NOT sign, submit, load keys, mutate Guardian policy or build an executable action. Local verification SHALL use injected fake RPC/fixtures and SHALL NOT count as live public-read evidence. A separate live smoke SHALL require an existing public account with a position and record actual network/source/timing; absent prerequisites SHALL remain [U], with no account creation required. P1.2/P1.4 UI parity and P4.3/P4.5 money-flow gates MUST remain separate.

#### Scenario: Missing public smoke prerequisite

- **WHEN** no usable public position can be established on the configured network
- **THEN** local tests may be recorded as tested-locally, but live smoke remains unchecked and its account/price prerequisite is labelled [U]

#### Scenario: Authority inspection

- **WHEN** route/server dependencies are reviewed
- **THEN** no signer, key loader, sender, LLM dependency or production fixture fallback is reachable
