## ADDED Requirements

### Requirement: Post-core extension with plain-wallet custody

[I, proposed requirements] Chat-driven opening SHALL be implemented only after the core submission is complete. The capability SHALL deposit collateral and borrow on Rhea as the connected wallet account, with one supported collateral/debt pair. It SHALL NOT route funds through a Guardian, create a Guardian, migrate a loan or imply automatic protection. Existing balances/debt in the supported pair MUST be included; other risk positions MUST refuse rather than be omitted from calculations.

#### Scenario: User asks to open a protected loan

- **WHEN** the user requests opening through a Guardian or automatic borrowing
- **THEN** the system explains that this capability supports reviewed wallet-held opening only and produces no Guardian or watcher transaction

#### Scenario: An existing supported wallet position is present

- **WHEN** a quote is requested for the same supported pair with existing collateral or debt
- **THEN** maximum additional borrow and resulting total debt/health include those balances, rather than assuming an empty account

### Requirement: Chat proposes intent but deterministic tools decide numbers

The model SHALL only interpret user intent and explain validated tool facts. Deposit amount, borrow maximum, chosen borrow amount bounds, resulting debt and health, prices, rates, fees and storage costs MUST originate in deterministic code. Transaction bytes MUST originate in `packages/rhea` builders. Token/lending ids, network, observed version and fee configuration MUST come from validated context, not arbitrary model-selected contracts. A reply with a number not returned by a tool MUST be rejected by the existing number guard.

#### Scenario: Model invents borrowing power

- **WHEN** generated prose contains a maximum borrow or health value absent from tool facts
- **THEN** the answer is rejected and that prose cannot create or alter an executable card

#### Scenario: User supplies an arbitrary receiver

- **WHEN** a chat request or tool argument attempts to override lending, fee recipient or signing account
- **THEN** argument validation refuses it and no executable payload is built

### Requirement: Conservative maximum borrow and resulting health

The engine SHALL calculate maximum additional principal and selected-principal resulting health using integer atomic/internal/share quantities, existing position liabilities, validated deployed-version rounding, target health, available liquidity and u128 bounds. Target health MUST be a whole number of basis points strictly above 10000 and be visible to the user. Health SHALL round down, debt up and collateral credit down. A selected amount MUST be positive and no greater than the calculated maximum. The system MUST NOT automatically choose or execute the maximum.

#### Scenario: Health bound is the limiting constraint

- **WHEN** the engine evaluates its maximum `m` at a selected target with sufficient liquidity
- **THEN** `m` meets the conservative target and `m + 1` atomic unit fails that bound, with before/after debt, health, target and rounding assumptions returned as tool facts

#### Scenario: Liquidity rather than health binds

- **WHEN** available validated liquidity is lower than the risk-based maximum
- **THEN** the engine reports the liquidity-constrained maximum and binding reason, and rejects an amount one atomic unit above it

#### Scenario: Zero maximum or invalid amount

- **WHEN** the maximum is zero, the amount is negative/zero, exceeds u128 after conversion, or the target is fractional or at/below 10000
- **THEN** no executable borrow card is produced and a typed refusal identifies the constraint

### Requirement: Prices, action flags and provenance must be usable

Opening context SHALL validate RPC network, lending id/version, token metadata, action permissions, share/liquidity data and source block provenance. Borrow quotes MUST validate every risk price, including the intended debt asset when current debt is zero. Both snapshot freshness and the stricter applicable application/protocol price-age limit SHALL apply. Unknown versions or unsupported/unverified share behavior MUST refuse execution. Missing data MUST NOT be replaced with zero, an old unsafe quote, a fixture or a different asset.

#### Scenario: Historical USDC missing-price failure

- **WHEN** the USDC price is null as in the recorded Gate 1 failure at block 277235533
- **THEN** borrowing refuses with `missing_price`, no health is presented as current, and no wallet borrow prompt or oracle-update transaction occurs

#### Scenario: Snapshot fresh but price expired

- **WHEN** the snapshot is fresh but an oracle price exceeds the lending validity limit, even if inside the application age limit
- **THEN** the borrow card is blocked until prices and all derived numbers are refreshed

#### Scenario: Version or source context is not verified

- **WHEN** lending version is unknown, pool/share fields are malformed, or reads are from mismatched source blocks
- **THEN** executable opening refuses without guessing a compatible encoding or retrying another version

### Requirement: Fixed-price testnet honesty

Configured `default_price` inputs SHALL retain their fixed-price source and null publish time. Cards, chat and review SHALL identify fixed prices and SHALL NOT describe them as current market prices. Snapshot-age validation still applies. Hypothetical shocks and replayed price-driven behavior MUST be labelled **Simulated**. Real fixed-price testnet deposits/borrows SHALL be distinguished from those simulations, not described as a fresh-oracle Gate 1 pass.

#### Scenario: wNEAR collateral and REF debt

- **WHEN** both assets use their configured defaults as in the recorded 2026-11-11 cycle
- **THEN** the quote states fixed prices, the receipt may describe an observed testnet transaction, and any hypothetical price shock remains labelled **Simulated**

### Requirement: Separate reviewed deposit and borrow commitments

The system SHALL produce action-discriminated `wallet_collateral_deposit` and `wallet_borrow` cards. Each SHALL show account/network, token amounts, inputs/source/time, assumptions, disclosed fees/recipients, storage deposits, risks, Adjust and Execute now. Borrow cards SHALL show maximum additional principal at the target, chosen principal, estimated wallet delivery, total resulting debt/health and APR. Adjust SHALL recompute numbers. A deposit preview MUST NOT authorize borrowing; borrow SHALL require a new quote from observed collateral and a separate explicit wallet approval.

#### Scenario: Deposit succeeded but user declines borrowing

- **WHEN** collateral is observed deposited and the user cancels or declines the borrow step
- **THEN** the UI keeps the deposited collateral visible, marks borrowing as unconfirmed/not completed and sends no automatic withdrawal or borrow

#### Scenario: Borrow amount adjusted

- **WHEN** the user edits the amount or target
- **THEN** the engine recomputes the maximum, delivery estimate, debt and health and the prior executable quote is invalidated

### Requirement: Registrations and costs are explicit prerequisites

Required lending/token registrations SHALL be built only for validated missing registrations and freshly read storage minimums within reviewed configured bounds. Each recipient and attached NEAR amount MUST be disclosed and independently verified. The user MUST already hold the deposit token and enough funds for disclosed fees/storage/deposits; gas estimates MUST be identified as estimates. Missing fee configuration SHALL block executable cards, not silently imply a zero fee. D24 USDC pricing MUST NOT be silently reused as a REF or two-stage pricing decision. This capability SHALL NOT add token sourcing, swaps, native wrapping or account creation.

#### Scenario: Registration absent

- **WHEN** lending registration or receipt-token registration is missing
- **THEN** only the required configured `storage_deposit` calls for the connected account are quoted before the affected action, with exact reviewed deposits

#### Scenario: Unknown fee or insufficient funds

- **WHEN** a stage lacks an applicable approved fee schedule or the wallet lacks its required token/NEAR balance
- **THEN** execution is blocked with the missing prerequisite and no silent fee waiver, token acquisition or signature occurs

### Requirement: Version-verified collateral and borrow encodings

The collateral builder SHALL emit the collateral token's `ft_transfer_call` to configured lending, with the exact atomic amount and `Execute` containing only `IncreaseCollateral` for that token, with no inner amount fields. The borrow builder SHALL emit lending `execute_with_pyth` containing only `Borrow` with explicit internal amount followed by `Withdraw` for the debt token with amount/max_amount omitted. Each affected transfer/execute SHALL attach exactly 1 yoctoNEAR. Builders MUST require the observed explicitly supported version and reject overflow or unknown versions.

#### Scenario: Share price is not one

- **WHEN** the debt pool uses the recorded REF supply ratio `370481008160211288092408 / 377384644082526848374484` and requested principal is `500000000000000000` atomic units
- **THEN** the regression demonstrates that credited supply shares floor to `490853316330478637` while exact-amount withdrawal requires `490853316330478638`, and the production builder emits only the amount-omitted withdrawal rather than the reverting exact form

#### Scenario: Receipt differs from requested principal

- **WHEN** borrow succeeds but rounding/interest means wallet delivery and debt differ from requested principal
- **THEN** the receipt shows observed delivered amount and total debt separately, without assuming a one-atomic-unit dust bound or displaying principal as actual delivery

### Requirement: Omitted amounts cannot silently consume existing supply

Before a collateral deposit whose `IncreaseCollateral` omits amount, the system MUST require zero existing supplied balance in that collateral token. Before a borrow whose `Withdraw` omits amount, it MUST require zero existing supplied balance in the debt token. Both checks MUST be repeated immediately before signing. A nonzero balance SHALL refuse with an explanation, not silently collateralize/withdraw old funds, substitute an exact amount, or add a cleanup transaction. This is a preflight invariant, not an on-chain concurrent-activity isolation guarantee.

#### Scenario: Borrow would withdraw old supplied funds

- **WHEN** the debt token already has a nonzero supplied balance, either when quoted or during the preflight read
- **THEN** no borrow signature is requested and the system explains the amount-omitted withdrawal would include existing supplied funds

#### Scenario: Deposit would collateralize old supply

- **WHEN** existing supplied collateral-token balance is nonzero
- **THEN** the deposit opening stage refuses instead of changing that undisclosed balance's collateral status

### Requirement: Browser verifier enforces the permission boundary

Before any wallet prompt, operation-specific verification beside `apps/web/src/execution/verify.ts` SHALL bind every transaction and nested argument to the deterministic card, independently validated context, connected signer and network. Verification MUST require exact receiver/method/order/count, units/amounts, fee and storage recipients/amounts, 1-yocto rules, canonical arguments and proven gas bounds. The existing shared signing seam SHALL accept only immutable verifier-issued objects for that account/network. NEAR Auth MUST remain signer-free. The agent/server MUST NOT sign or submit transactions.

#### Scenario: Hostile payload mutation

- **WHEN** a payload adds AddKey, DeleteKey, native Transfer, deploy, stake, a Guardian method, extra nested key, changed receiver/amount/deposit, reordered action or excessive gas
- **THEN** verification fails and wallet call count is zero

#### Scenario: Counterfeit verified object or wrong session

- **WHEN** an object merely resembles verified output, or account/network changes after quoting
- **THEN** the signer refuses it and no transaction is sent

### Requirement: Fresh preflight and one submission per commitment

Execution SHALL refresh FINAL position/market/price/pool/registration/balance context immediately before asking the wallet. Any material quote input change SHALL require recomputation and renewed review. No borrowing SHALL be triggered by an unobserved deposit. A card SHALL be locked once the wallet is asked; duplicate activation, rejection, ambiguous outcomes or a read timeout MUST NOT initiate an automatic second submission. Read-only Check again SHALL not sign or send.

#### Scenario: Double activation

- **WHEN** Execute is activated twice for the same card
- **THEN** at most one wallet request is made

#### Scenario: Pool or collateral changes

- **WHEN** fresh preflight sees changed collateral, debt, pool/share/liquidity inputs or a changed price
- **THEN** signing is blocked and a newly reviewed deterministic quote is required

### Requirement: Outcomes are observed per stage and receipt branch

Confirmation SHALL require validated relevant FINAL transaction/receipt outcomes and fresh observed post-state. Deposit confirmation MUST reconcile resolver acceptance/refund with collateral application. Borrow confirmation MUST observe borrowed debt, withdrawal delivery evidence and fresh wallet/Rhea state; a wallet balance delta alone is not causal proof. Fees/registrations SHALL have separate observed statuses. The existing repay outcome reader MUST NOT be used unchanged to classify increased debt. Hash-only results or first-receipt success MUST NOT produce confirmed status, health or explorer links.

#### Scenario: Root success but downstream failure

- **WHEN** a root outcome succeeds but collateralization, withdrawal or a token receipt fails
- **THEN** the stage is failed, partial or unresolved according to actual applied effects, never falsely confirmed

#### Scenario: Refund or fee failure

- **WHEN** an FT transfer is partially/fully refunded or a fee fails after the lending action applied
- **THEN** actual collateral/debt/delivery and paid/unpaid fee results are shown separately; no applied action is undone or automatically repeated

#### Scenario: Borrowed debt exists without observed wallet delivery

- **WHEN** post-state has debt but withdrawal failed or delivery cannot be established
- **THEN** the UI explicitly shows debt exists with incomplete/unknown delivery, not a confirmed completed opening

### Requirement: Honest recovery and non-guarantees

Wallet errors SHALL cause fresh observation, not an invented cancellation or successful receipt. Unresolved results SHALL stay locked with read-only Check again; missing hashes MUST NOT create explorer links. Recovery after a completed deposit and blocked borrow SHALL retain the actual collateral state. All observed balances/health SHALL carry provenance/time and remain distinct from projections. Mood SHALL remain engine-derived. Review/card copy SHALL disclose added debt/liquidation risk, fixed-price limitations, share rounding, interest/rate movement, gas/storage costs and the lack of cross-stage atomicity or concurrent-activity isolation. No health, exact delivery, future liquidity, oracle accuracy, wallet-display accuracy or Guardian protection guarantee SHALL be made.

#### Scenario: Wallet error with uncertain submission

- **WHEN** the wallet throws without complete hashes and a fresh read is unavailable or shows changes
- **THEN** the UI reports unknown or observed change as appropriate, offers read-only reconciliation, makes no causal/confirmation claim and does not resend

#### Scenario: Public evidence gate

- **WHEN** only local fixture or sandbox evidence exists for this extension
- **THEN** the feature is described as locally tested only if actually exercised, all simulations are labelled, and public-wallet acceptance remains unclaimed until an authorized run records outcomes and post-state
