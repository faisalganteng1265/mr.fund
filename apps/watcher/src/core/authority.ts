import { type GuardianSnapshot, REJECT_REASONS } from "@mrfund/guardian-client";
import { err, isValidAccountId, ok, type Result } from "@mrfund/shared";
import type { RejectReason, RepayRequester, RequestOutcome, SubmitResult, TxLookup } from "./types";

export const REQUEST_METHOD = "request_repay";
/** Gas for one `request_repay`: the composed read → repay → resolver → fee chain fits 300 Tgas (D27). */
export const REQUEST_GAS = 300_000_000_000_000n;

type Network = "testnet" | "mainnet";

/** Named accounts carry their network suffix; 64-hex implicit accounts are network-neutral. */
export function accountMatchesNetwork(accountId: string, network: Network): boolean {
  if (!isValidAccountId(accountId)) return false;
  if (/^[0-9a-f]{64}$/.test(accountId)) return true;
  const testnet = accountId === "testnet" || accountId.endsWith(".testnet");
  return network === "testnet" ? testnet : !testnet;
}

export interface AuthorityInput {
  /** Network the operator selected. */
  network: Network;
  /** `chain_id` reported by the RPC node the signer will use. */
  rpcChainId: string;
  /** Account that holds the function-call key. */
  watcherAccountId: string;
  /** Fresh Guardian views; `config.watcherId` must name this watcher. */
  guardian: GuardianSnapshot;
  /** Raw `view_access_key` result for the configured public key, untrusted. */
  accessKey: unknown;
}

export interface VerifiedAuthority {
  readonly network: Network;
  readonly watcherAccountId: string;
  readonly guardianId: string;
  readonly allowance: bigint;
}

const refuse = (reason: string): Result<never, string> => err(reason);

/**
 * Startup permission check, before anything is signed (BUILD-PLAN P5.3 boundary).
 * Accepts only a function-call key on the watcher account whose receiver is exactly this
 * Guardian, whose method list is exactly `["request_repay"]` and whose allowance is finite.
 * Full-access keys, empty method lists (= any method), extra methods, other receivers and
 * network mismatches are refused.
 * Does not guarantee: that the contract will accept a request; it re-checks the caller.
 */
export function verifyAuthority(input: AuthorityInput): Result<VerifiedAuthority, string> {
  const { network, guardian } = input;
  if (input.rpcChainId !== network) return refuse("rpc_network_mismatch");
  if (guardian.network !== network) return refuse("guardian_network_mismatch");
  for (const id of [input.watcherAccountId, guardian.guardianId, guardian.config.watcherId])
    if (!accountMatchesNetwork(id, network)) return refuse("account_network_mismatch");
  if (guardian.config.watcherId !== input.watcherAccountId) return refuse("not_guardian_watcher");
  const key = input.accessKey;
  if (typeof key !== "object" || key === null) return refuse("access_key_unreadable");
  const permission = (key as { permission?: unknown }).permission;
  if (permission === "FullAccess") return refuse("full_access_key");
  const call =
    typeof permission === "object" && permission !== null
      ? (permission as { FunctionCall?: unknown }).FunctionCall
      : undefined;
  if (typeof call !== "object" || call === null) return refuse("access_key_unreadable");
  const { receiver_id, method_names, allowance } = call as Record<string, unknown>;
  if (receiver_id !== guardian.guardianId) return refuse("wrong_receiver");
  if (
    !Array.isArray(method_names) ||
    method_names.length !== 1 ||
    method_names[0] !== REQUEST_METHOD
  )
    return refuse("broad_method_list");
  if (typeof allowance !== "string" || !/^[1-9][0-9]{0,38}$/.test(allowance))
    return refuse("unbounded_allowance");
  return ok({
    network,
    watcherAccountId: input.watcherAccountId,
    guardianId: guardian.guardianId,
    allowance: BigInt(allowance),
  });
}

/** The only transaction shape the signer port can be asked to sign. */
export interface RepayCall {
  signerId: string;
  receiverId: string;
  methodName: typeof REQUEST_METHOD;
  args: { amount: string };
  gas: bigint;
  deposit: 0n;
}

/** Runtime adapter (Node entry) that signs with the configured function-call key. */
export interface SignerPort {
  send(call: RepayCall): Promise<SubmitResult>;
  lookup(hash: string): Promise<TxLookup>;
}

const U128_MAX = (1n << 128n) - 1n;

/**
 * Wrap a signer so the watcher core can only request repayments from the verified Guardian,
 * with zero deposit. There is no method, receiver or deposit parameter to misuse.
 */
export function constrainedRequester(
  authority: VerifiedAuthority,
  port: SignerPort,
): RepayRequester {
  return {
    network: authority.network,
    guardianId: authority.guardianId,
    async requestRepay(amount) {
      if (typeof amount !== "bigint" || amount <= 0n || amount > U128_MAX)
        return { kind: "refused", reason: "invalid_amount" };
      return port.send({
        signerId: authority.watcherAccountId,
        receiverId: authority.guardianId,
        methodName: REQUEST_METHOD,
        args: { amount: amount.toString() },
        gas: REQUEST_GAS,
        deposit: 0n,
      });
    },
    lookup: (hash) => port.lookup(hash),
  };
}

const u = (value: unknown, max: bigint): bigint | null =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) <= max
    ? BigInt(value)
    : null;

/** Parse the JSON `request_repay` return value (SMART-CONTRACT "RequestOutcome"). Untrusted. */
export function parseRequestOutcome(value: unknown): RequestOutcome | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const opId = u(v.op_id, (1n << 64n) - 1n);
  if (opId === null) return null;
  switch (v.outcome) {
    case "rejected":
      return REJECT_REASONS.includes(v.reason as RejectReason)
        ? { outcome: "rejected", opId, reason: v.reason as RejectReason }
        : null;
    case "executed": {
      const used = u(v.used, U128_MAX),
        fee = u(v.fee, U128_MAX);
      return used === null || fee === null ? null : { outcome: "executed", opId, used, fee };
    }
    case "failed":
    case "unresolved":
      return { outcome: v.outcome, opId };
    default:
      return null;
  }
}
