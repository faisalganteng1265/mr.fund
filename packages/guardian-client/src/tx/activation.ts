/**
 * Guardian activation payloads against the final factory/Guardian ABI (SMART-CONTRACT
 * "Final ABI for the client"). Unsigned only: the user's wallet signs each step.
 *
 * Permission boundary: the owner's wallet signs every step; the factory makes the signer the
 * owner, the Guardian accepts `owner_register` only from the owner with exactly 1 yocto, and
 * `ft_on_transfer` accepts the `activate` message only from the owner, for the debt token,
 * while the Guardian is `created`.
 * Does not guarantee: that a step succeeds (each outcome must be observed on-chain), that a
 * failed creation refunds gas, or that the Guardian's NEAR can ever be withdrawn.
 */
import {
  type EngineError,
  err,
  ftTransferCall,
  type GuardianPolicy,
  isValidAccountId,
  type NearTransaction,
  ok,
  type Result,
  validatePolicy,
} from "@mrfund/shared";
import type { GuardianSnapshot } from "../types";

const TGAS = 1_000_000_000_000n;
const U128_MAX = (1n << 128n) - 1n;
/** Factory floor is 145 Tgas (create 100 + callback 25 + 2 × 10 follow-up); 5 Tgas headroom. */
export const CREATE_GUARDIAN_GAS = 150n * TGAS;
/** [I] Estimate: 30 Tgas `storage_deposit` + 10 Tgas callback + method execution. Measure in P2.8. */
export const OWNER_REGISTER_GAS = 60n * TGAS;
export const CLAIM_REFUND_GAS = 30n * TGAS;
export const ACTIVATE_MSG = JSON.stringify({ activate: {} });
const SNAPSHOT_LIMIT_MS = 120_000;

/** Factory facts read from chain (`get_template`, `get_limits`), never hard-coded. */
export interface FactoryInfo {
  factoryId: string;
  minFunding: bigint;
  maxFunding: bigint;
  debtTokenId: string;
  collateralTokenId: string;
  lendingId: string;
  feeRecipientId: string;
  activationFee: bigint;
}

const bad = (reason: string): Result<never, EngineError> => err({ kind: "invalid_input", reason });

/** The exact JSON the contract's `Policy` deserializes. */
export function policyWire(p: GuardianPolicy) {
  return {
    max_per_action: p.maxPerAction.toString(),
    lifetime_cap: p.lifetimeCap.toString(),
    reserve_floor: p.reserveFloor.toString(),
    trigger_hf_bps: p.triggerHfBps,
    target_hf_bps: p.targetHfBps,
    cooldown_sec: p.cooldownSec,
    action_fee: p.actionFee.toString(),
  };
}

/**
 * Step 1: `create_guardian({policy})` on the factory with NEAR funding in
 * `[min_funding, max_funding]`. Refused while a creation is already in flight for the owner.
 */
export function createGuardianPayload(
  factory: FactoryInfo,
  policy: GuardianPolicy,
  fundingYocto: bigint,
  context: { ownerId: string; creationPending: boolean },
): Result<NearTransaction[], EngineError> {
  if (!isValidAccountId(factory.factoryId)) return bad("Invalid factory account");
  if (!isValidAccountId(context.ownerId)) return bad("Invalid owner account");
  if (context.creationPending) return bad("A Guardian creation is already in flight");
  const valid = validatePolicy(policy);
  if (!valid.ok) return valid;
  if (typeof fundingYocto !== "bigint" || fundingYocto > U128_MAX)
    return bad("Invalid funding amount");
  if (fundingYocto < factory.minFunding)
    return err({ kind: "invalid_amount", reason: "funding is below the factory minimum" });
  if (fundingYocto > factory.maxFunding)
    return err({ kind: "invalid_amount", reason: "funding is above the factory maximum" });
  return ok([
    {
      receiverId: factory.factoryId,
      actions: [
        {
          methodName: "create_guardian",
          args: { policy: policyWire(policy) },
          gas: CREATE_GUARDIAN_GAS,
          deposit: fundingYocto,
        },
      ],
    },
  ]);
}

/** `claim_refund()` with exactly 1 yocto, only when the factory holds an unclaimed refund. */
export function claimRefundPayload(
  factoryId: string,
  unclaimed: bigint,
): Result<NearTransaction[], EngineError> {
  if (!isValidAccountId(factoryId)) return bad("Invalid factory account");
  if (unclaimed <= 0n) return bad("No refund is claimable");
  return ok([
    {
      receiverId: factoryId,
      actions: [{ methodName: "claim_refund", args: {}, gas: CLAIM_REFUND_GAS, deposit: 1n }],
    },
  ]);
}

function ownerChecks(
  snapshot: GuardianSnapshot,
  context: { ownerId: string; nowMs: number },
): Result<null, EngineError> {
  if (
    !isValidAccountId(snapshot.guardianId) ||
    context.ownerId !== snapshot.config.ownerId ||
    snapshot.status.ownerId !== context.ownerId
  )
    return bad("Only the configured owner may build activation steps");
  if (
    !Number.isSafeInteger(context.nowMs) ||
    !Number.isSafeInteger(snapshot.readAtMs) ||
    context.nowMs < snapshot.readAtMs
  )
    return bad("Invalid activation draft timestamp");
  const age = context.nowMs - snapshot.readAtMs;
  if (age > SNAPSHOT_LIMIT_MS)
    return err({ kind: "stale_snapshot", ageMs: age, limitMs: SNAPSHOT_LIMIT_MS });
  if (snapshot.status.status !== "created") return bad("The Guardian is already activated");
  if (snapshot.status.inFlight !== null) return bad("Operation in flight");
  return ok(null);
}

export type RegistrationTarget = "lending" | "debt_token" | "collateral_token";
/** Order the flow follows: the lending contract first, then the debt and collateral tokens. */
export const REGISTRATION_ORDER: readonly RegistrationTarget[] = [
  "lending",
  "debt_token",
  "collateral_token",
];

export function registrationTargetId(snapshot: GuardianSnapshot, target: RegistrationTarget) {
  return target === "lending"
    ? snapshot.config.lendingId
    : target === "debt_token"
      ? snapshot.config.debtTokenId
      : snapshot.config.collateralTokenIds[0];
}

/**
 * Step 2 (one target per transaction, because each call holds the Guardian's lock until its
 * callback): `owner_register({target_id, storage_deposit})` with exactly 1 yocto. The storage
 * deposit is paid from the Guardian's own NEAR balance, not attached by the wallet.
 */
export function ownerRegisterPayload(
  snapshot: GuardianSnapshot,
  target: RegistrationTarget,
  storageDepositYocto: bigint,
  context: { ownerId: string; nowMs: number },
): Result<NearTransaction[], EngineError> {
  const checked = ownerChecks(snapshot, context);
  if (!checked.ok) return checked;
  if (!REGISTRATION_ORDER.includes(target)) return bad("Unsupported registration target");
  if (
    typeof storageDepositYocto !== "bigint" ||
    storageDepositYocto <= 0n ||
    storageDepositYocto > U128_MAX
  )
    return bad("Storage deposit must be positive");
  const targetId = registrationTargetId(snapshot, target);
  if (!targetId) return bad("Missing registration target");
  return ok([
    {
      receiverId: snapshot.guardianId,
      actions: [
        {
          methodName: "owner_register",
          args: { target_id: targetId, storage_deposit: storageDepositYocto.toString() },
          gas: OWNER_REGISTER_GAS,
          deposit: 1n,
        },
      ],
    },
  ]);
}

export interface ActivationDraft {
  payload: NearTransaction[];
  /** What lands in the reserve after the fee is paid. */
  reserve: bigint;
  /** Immutable `activation_fee` from the Guardian config, paid to `feeRecipientId`. */
  fee: bigint;
  feeRecipientId: string;
  /** Debt-token amount the wallet sends: reserve + fee. */
  total: bigint;
  debtTokenId: string;
}

/**
 * Step 3: the debt token's `ft_transfer_call(receiver_id: <guardian>, amount: reserve + fee,
 * msg: {"activate":{}})`. The contract refunds the whole amount unless it covers
 * fee + reserve floor + max per action + action fee, so the same minimum is enforced here.
 */
export function activationPayload(
  snapshot: GuardianSnapshot,
  reserve: bigint,
  context: { ownerId: string; nowMs: number; factory?: FactoryInfo },
): Result<ActivationDraft, EngineError> {
  const checked = ownerChecks(snapshot, context);
  if (!checked.ok) return checked;
  const expected = context.factory;
  // The fee and recipient shown before creation must be the ones this Guardian will pay.
  if (
    expected &&
    (expected.activationFee !== snapshot.config.activationFee ||
      expected.feeRecipientId !== snapshot.config.feeRecipientId ||
      expected.debtTokenId !== snapshot.config.debtTokenId ||
      expected.lendingId !== snapshot.config.lendingId)
  )
    return bad("Guardian configuration does not match the factory template that was shown");
  if (typeof reserve !== "bigint" || reserve <= 0n) return bad("Reserve must be positive");
  const { policy, config } = snapshot;
  const minimum = policy.reserveFloor + policy.maxPerAction + policy.actionFee;
  if (reserve < minimum)
    return err({
      kind: "invalid_amount",
      reason: "reserve must cover the floor, one action and one action fee",
    });
  const total = reserve + config.activationFee;
  if (total > U128_MAX) return bad("Amount exceeds the largest u128");
  const transfer = ftTransferCall(config.debtTokenId, snapshot.guardianId, total, ACTIVATE_MSG);
  if (!transfer.ok) return transfer;
  return ok({
    payload: [transfer.value],
    reserve,
    fee: config.activationFee,
    feeRecipientId: config.feeRecipientId,
    total,
    debtTokenId: config.debtTokenId,
  });
}
