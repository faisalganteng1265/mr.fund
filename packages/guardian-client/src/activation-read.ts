import { err, isValidAccountId, ok, type Result } from "@mrfund/shared";
import { account, record, uint } from "./parse";
import { readGuardian } from "./read";
import {
  type FactoryInfo,
  REGISTRATION_ORDER,
  type RegistrationTarget,
  registrationTargetId,
} from "./tx/activation";
import type {
  GuardianReadError,
  GuardianReadOptions,
  GuardianSnapshot,
  GuardianTarget,
  GuardianViewClient,
} from "./types";

type Network = GuardianTarget["network"];

/**
 * Where an owner's activation stands, derived only from chain views (invariant G-UI-4), so a
 * reload resumes at the right step instead of trusting component memory.
 * - `none`: no Guardian and nothing in flight.
 * - `pending`: the factory reports a creation in flight; show no Guardian yet.
 * - `failed`: no Guardian, and the factory holds a claimable refund of `unclaimed`.
 * - `created`: the Guardian exists; `next` is the first unregistered target.
 * - `registered`: every target is registered; the reserve and activation fee are next.
 * - `activated`: status is active, paused or deactivated (see `guardian.status.status`).
 * `unclaimed` is reported in every state because a later failed attempt can leave a refund.
 */
export type ActivationState =
  | { kind: "none"; nextGuardianId: string; unclaimed: bigint }
  | { kind: "pending"; nextGuardianId: string; unclaimed: bigint }
  | { kind: "failed"; unclaimed: bigint }
  | {
      kind: "created";
      guardian: GuardianSnapshot;
      registered: Record<RegistrationTarget, boolean>;
      next: RegistrationTarget;
      unclaimed: bigint;
    }
  | { kind: "registered"; guardian: GuardianSnapshot; unclaimed: bigint }
  | { kind: "activated"; guardian: GuardianSnapshot; unclaimed: bigint };

const bad = (detail = "Invalid factory view data"): Result<never, GuardianReadError> =>
  err({ kind: "bad_response", detail });

async function view(
  client: GuardianViewClient,
  contractId: string,
  method: string,
  args: unknown,
  blockId?: string,
) {
  let r: Awaited<ReturnType<GuardianViewClient["view"]>>;
  try {
    r = await client.view(contractId, method, args, blockId);
  } catch {
    return err({ kind: "rpc_unavailable", detail: "Factory RPC unavailable" } as const);
  }
  return r;
}

/** `get_template` + `get_limits`, read at one block, as the facts the setup form shows. */
export async function readFactory(
  client: GuardianViewClient,
  factoryId: string,
): Promise<Result<FactoryInfo, GuardianReadError>> {
  if (!isValidAccountId(factoryId)) return bad("Invalid factory account");
  const template = await view(client, factoryId, "get_template", {});
  if (!template.ok) return template;
  const limits = await view(client, factoryId, "get_limits", {}, template.value.blockHash);
  if (!limits.ok) return limits;
  try {
    const t = record(template.value.data);
    const l = record(limits.value.data);
    const info: FactoryInfo = {
      factoryId,
      minFunding: uint(l.min_funding),
      maxFunding: uint(l.max_funding),
      debtTokenId: account(t.debt_token_id),
      collateralTokenId: account(t.collateral_token_id),
      lendingId: account(t.lending_id),
      feeRecipientId: account(t.fee_recipient_id),
      activationFee: uint(t.activation_fee),
    };
    if (info.maxFunding < info.minFunding || info.debtTokenId === info.collateralTokenId)
      return bad();
    return ok(info);
  } catch {
    return bad();
  }
}

/** Resume point for `ownerId`'s activation; every value comes from a view call. */
export async function readActivationState(
  client: GuardianViewClient,
  target: { network: Network; factoryId: string },
  ownerId: string,
  options: GuardianReadOptions = {},
): Promise<Result<ActivationState, GuardianReadError>> {
  if (!isValidAccountId(target.factoryId) || !isValidAccountId(ownerId))
    return bad("Invalid factory or owner account");
  const anchor = await view(client, target.factoryId, "get_guardian", { owner_id: ownerId });
  if (!anchor.ok) return anchor;
  const at = anchor.value.blockHash;
  const [pending, unclaimedView, nextView] = await Promise.all([
    view(client, target.factoryId, "is_pending", { owner_id: ownerId }, at),
    view(client, target.factoryId, "get_unclaimed", { owner_id: ownerId }, at),
    view(client, target.factoryId, "get_next_guardian_id", { owner_id: ownerId }, at),
  ]);
  if (!pending.ok) return pending;
  if (!unclaimedView.ok) return unclaimedView;
  if (!nextView.ok) return nextView;
  let guardianId: string | null;
  let unclaimed: bigint;
  let nextGuardianId: string;
  try {
    guardianId = anchor.value.data === null ? null : account(anchor.value.data);
    if (typeof pending.value.data !== "boolean") return bad();
    unclaimed = uint(unclaimedView.value.data);
    nextGuardianId = account(nextView.value.data);
  } catch {
    return bad();
  }
  if (pending.value.data) return ok({ kind: "pending", nextGuardianId, unclaimed });
  if (guardianId === null)
    return ok(
      unclaimed > 0n ? { kind: "failed", unclaimed } : { kind: "none", nextGuardianId, unclaimed },
    );

  const guardian = await readGuardian(client, { network: target.network, guardianId }, options);
  if (!guardian.ok) return guardian;
  const g = guardian.value;
  if (g.config.ownerId !== ownerId) return bad("Guardian owner does not match the factory record");
  if (g.status.status !== "created") return ok({ kind: "activated", guardian: g, unclaimed });

  const registered = {} as Record<RegistrationTarget, boolean>;
  for (const t of REGISTRATION_ORDER) {
    const id = registrationTargetId(g, t);
    if (!id) return bad();
    const r = await view(client, id, "storage_balance_of", { account_id: g.guardianId });
    if (!r.ok) return r;
    if (r.value.data !== null && (typeof r.value.data !== "object" || Array.isArray(r.value.data)))
      return bad("Invalid storage balance");
    registered[t] = r.value.data !== null;
  }
  const next = REGISTRATION_ORDER.find((t) => !registered[t]);
  return ok(
    next
      ? { kind: "created", guardian: g, registered, next, unclaimed }
      : { kind: "registered", guardian: g, unclaimed },
  );
}
