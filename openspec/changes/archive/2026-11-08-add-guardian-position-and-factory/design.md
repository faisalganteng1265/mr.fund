## Context

P2.4/P2.6 explicitly wait for D18. Rhea only repays the caller's own debt; owner wallet loans cannot migrate implicitly. Factory is a scaffold; current Guardian receiver accepts only reserve activation/deposit.

## Goals / Non-Goals

Goals: conditional G1/G3 owner lifecycle and keyless provisioning.
Non-goals: selecting custody, public account creation, network deployment or collateral/debt migration from wallet loans.

## Decisions

Settlement ABI dependency: provisioning must populate immutable verified `lending_version`, debt/collateral extra decimals, feed ids and freshness seconds from trusted network configuration, matching docs/technical/SMART-CONTRACT.md. All position/sweep methods must honor the shared Reading/Repaying/Fee/Unresolved lock; unresolved has no administrative unlock. Local settlement tests seed positions through sandbox code/state patching only and are not a production provisioning implementation.

- STOP before implementation until founder records D18 G1/G3. G2 invalidates this change and requires a replacement scope; artifact completeness is not permission to proceed.
- Once gated, add explicit collateral funding/registration and owner-only borrow, release, manual reserve repay and sweep. Every owner mutation requires predecessor owner plus 1 yocto; callbacks match operation and fixed destinations. Watcher cannot route funds, borrow or sweep.
- Protect reserve/in-flight/fee commitments from sweep, including async balance-read races. Reuse a shared operation lock with settlement and reserve operations; manual repay is fee-free but still reconciles refunds and accepted surplus. Borrowed tokens are distinct from reserve accounting.
- Run a local provisioning/storage spike comparing supported stored-code/global deployment strategies on the pinned toolchain. Record measured funding floor and chosen strategy before production factory code; do not pretend a global-contract ABI works without proof.
- Factory derives collision-resistant child ids under its own namespace, binds owner/config, guards concurrent duplicate creation, and publishes owner mapping only after successful initialization. Never add access keys or an upgrade method; config/fee recipient cannot be replaced later. Exact account naming and creation/refund ABI must be recorded from the spike before client builders depend on it.
- Track each create operation and actual recoverable funds. Failed initialization after child creation may leave a keyless unusable child; report the exact phase and recoverable amount, never promise a full refund of funds already committed to that child. Excess funding refunds use private checked callbacks; prevent duplicate refund/mapping.
- Sandbox asserts empty access-key list, fixed code/config, owner lifecycle and I10. Factory code updates affect new Guardians only.

Permission boundary: owner + 1 yocto position operations; factory creation only for validated requested owner/config and explicit funding. Invariants I4/I5/I9/I10 plus reserve exclusion from sweep. Negative tests cover foreign callers, duplicate creation, underfunding, failed deploy/init/refund, callback replay and sweep race. No upgrade/recovery guarantee for keyless failed children or liquidation protection.

## Risks / Trade-offs

Keyless failed initialization can trap funding → measure/stage creation carefully and disclose exact failure outcomes. Protocol calls may detach failures → inspect all receipts and final token/position state.

## Migration Plan

No deployed state migration. Finalize additive config/receiver ABI with settlement first, then update Guardian client builders. Public deployment stays separately gated by D19/B7.

## Open Questions

D18 is required. Code strategy, measured funding floor and child failure behavior are mandatory local experiment outputs, not founder decisions invented here.

## Measured results (task 1.2/1.3, 2026-11-07)

Stored code was chosen over global contracts; numbers and the refund ABI are in `docs/technical/SMART-CONTRACT.md` "Provisioning experiment". Two assumptions above changed: (1) create, transfer, deploy and init run in one receipt that reverts atomically, so a failed creation leaves no keyless child (the failed-initialization-after-creation case is not reachable with this strategy); the deposit returns to the factory and is forwarded to the owner in a checked callback. (2) The factory embeds the Guardian bytes and has no code setter; a new Guardian build means a new factory. The global strategy remains open only with a passing testnet publish/use and an explanation of its unbound storage check.
