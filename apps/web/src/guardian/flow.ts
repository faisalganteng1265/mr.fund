/**
 * Step-wise activation (task 3.2): create → register (lending, debt token, collateral token) →
 * reserve plus activation fee. The next step is derived only from `readActivationState`
 * (invariant G-UI-4), so a reload resumes at the first incomplete step. A Guardian is shown as
 * created only when the factory reports one (G-UI-3); a submitted creation whose result has not
 * been observed yet is "unresolved", never "created".
 */
import {
  type ActivationState,
  activationPayload,
  claimRefundPayload,
  createGuardianPayload,
  type FactoryInfo,
  type GuardianSnapshot,
  guardianOwnerPayload,
  ownerRegisterPayload,
  type RegistrationTarget,
} from "@mrfund/guardian-client";
import type { GuardianPolicy, NearTransaction } from "@mrfund/shared";
import type { ControlKind } from "./controls";
import type { GuardianIntent } from "./verify";

export type ActivationStep =
  | { kind: "create" }
  | { kind: "wait_creation" }
  | { kind: "claim_refund"; amount: bigint }
  | { kind: "register"; target: RegistrationTarget }
  | { kind: "activate" }
  | { kind: "done" };

export function nextActivationStep(state: ActivationState): ActivationStep {
  switch (state.kind) {
    case "none":
      return { kind: "create" };
    case "pending":
      return { kind: "wait_creation" };
    case "failed":
      return { kind: "claim_refund", amount: state.unclaimed };
    case "created":
      return { kind: "register", target: state.next };
    case "registered":
      return { kind: "activate" };
    case "activated":
      return { kind: "done" };
  }
}

/** What the wallet was last asked to do, kept only until a fresh read moves past it. */
export interface Submission {
  intent: GuardianIntent["kind"];
  /** Transaction hashes the wallet reported, when it reported any. */
  hashes: string[];
}

export type ActivationProgress =
  | { kind: "step"; step: ActivationStep }
  /** A creation was sent but the factory shows nothing yet: no Guardian is shown. */
  | { kind: "unresolved"; hashes: string[] };

/**
 * Chain state first; a submission only adds an "unresolved" notice while the read has not
 * moved on. It never advances the step by itself.
 */
export function activationProgress(
  state: ActivationState,
  submission: Submission | null,
): ActivationProgress {
  const step = nextActivationStep(state);
  if (submission?.intent === "create" && step.kind === "create")
    return { kind: "unresolved", hashes: submission.hashes };
  return { kind: "step", step };
}

export interface StepInput {
  ownerId: string;
  nowMs: number;
  factory: FactoryInfo;
  /** Reviewed terms for creation and activation; absent after a reload until re-entered. */
  policy?: GuardianPolicy;
  reserve?: bigint;
  /** NEP-145 minimum read from the target contract. */
  storageDeposit?: bigint;
}

export type Built =
  | { ok: true; intent: GuardianIntent; payload: NearTransaction[] }
  | { ok: false; reason: string };

const reasonOf = (e: { kind: string; reason?: string }) =>
  e.kind === "stale_snapshot" ? "Refresh the Guardian first." : (e.reason ?? e.kind);

/** Unsigned payload and its intent for the current activation step. */
export function buildActivationStep(state: ActivationState, input: StepInput): Built {
  const step = nextActivationStep(state);
  const owner = { ownerId: input.ownerId, nowMs: input.nowMs };
  switch (step.kind) {
    case "create": {
      if (!input.policy) return { ok: false, reason: "Review your policy first." };
      const funding = input.factory.minFunding;
      const r = createGuardianPayload(input.factory, input.policy, funding, {
        ownerId: input.ownerId,
        creationPending: false,
      });
      return r.ok
        ? { ok: true, intent: { kind: "create", policy: input.policy, funding }, payload: r.value }
        : { ok: false, reason: reasonOf(r.error) };
    }
    case "claim_refund": {
      const r = claimRefundPayload(input.factory.factoryId, step.amount);
      return r.ok
        ? { ok: true, intent: { kind: "claim_refund" }, payload: r.value }
        : { ok: false, reason: reasonOf(r.error) };
    }
    case "register": {
      if (state.kind !== "created") return { ok: false, reason: "Refresh the Guardian first." };
      if (input.storageDeposit === undefined)
        return { ok: false, reason: "The storage minimum could not be read." };
      const r = ownerRegisterPayload(state.guardian, step.target, input.storageDeposit, owner);
      return r.ok
        ? {
            ok: true,
            intent: { kind: "register", target: step.target, storageDeposit: input.storageDeposit },
            payload: r.value,
          }
        : { ok: false, reason: reasonOf(r.error) };
    }
    case "activate": {
      if (state.kind !== "registered") return { ok: false, reason: "Refresh the Guardian first." };
      if (input.reserve === undefined) return { ok: false, reason: "Enter the reserve first." };
      const r = activationPayload(state.guardian, input.reserve, {
        ...owner,
        factory: input.factory,
      });
      return r.ok
        ? {
            ok: true,
            intent: { kind: "activate", reserve: input.reserve },
            payload: r.value.payload,
          }
        : { ok: false, reason: reasonOf(r.error) };
    }
    case "wait_creation":
      return { ok: false, reason: "A creation is already in flight. Check again shortly." };
    case "done":
      return { ok: false, reason: "The Guardian is already activated." };
  }
}

/** Unsigned owner-control payload; availability is checked by `controlAvailability` first. */
export function buildControl(
  guardian: GuardianSnapshot,
  control: ControlKind,
  input: { ownerId: string; nowMs: number; amount?: bigint },
): Built {
  const owner = { ownerId: input.ownerId, nowMs: input.nowMs };
  if (control === "withdraw") {
    const amount = input.amount ?? guardian.reserve.reserve;
    const r = guardianOwnerPayload(guardian, { kind: "withdraw_reserve", amount }, owner);
    return r.ok
      ? { ok: true, intent: { kind: "withdraw", amount }, payload: r.value }
      : { ok: false, reason: reasonOf(r.error) };
  }
  const r = guardianOwnerPayload(guardian, { kind: control }, owner);
  return r.ok
    ? { ok: true, intent: { kind: control }, payload: r.value }
    : { ok: false, reason: reasonOf(r.error) };
}

/** Unsigned `set_policy` for limits the owner reviewed; availability is checked by the panel. */
export function buildPolicyEdit(
  guardian: GuardianSnapshot,
  policy: GuardianPolicy,
  input: { ownerId: string; nowMs: number },
): Built {
  const r = guardianOwnerPayload(guardian, { kind: "set_policy", policy }, input);
  return r.ok
    ? { ok: true, intent: { kind: "policy", policy }, payload: r.value }
    : { ok: false, reason: reasonOf(r.error) };
}
