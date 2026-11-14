import { baseDecode, baseEncode } from "near-api-js";
import {
  REQUEST_GAS,
  REQUEST_METHOD,
  type RepayCall,
  type SignerPort,
  type VerifiedAuthority,
} from "../core/authority";
import type { TxLookup } from "../core/types";

interface SignedRequest<T> {
  hash: string;
  signed: T;
}
/** Single-use write-ahead record: the intent is durable before signing, the hash before broadcast. */
export interface SignerJournal {
  begin(call: RepayCall): Promise<void>;
  recordHash(hash: string): Promise<void>;
  close(): Promise<void>;
}
interface SignerDependencies<T> {
  /** Must check network, Guardian and current access-key permission immediately before signing. */
  verify(): Promise<boolean>;
  /** Remains false until the external public submission gates have been met. */
  submissionAllowed(): boolean;
  /** Optional single-use durable barrier; no broadcast may precede its hash sync. */
  journal?: SignerJournal;
  sign(call: RepayCall): Promise<SignedRequest<T>>;
  broadcast(signed: T): Promise<void>;
  lookup(hash: string): Promise<TxLookup>;
}

/** A single outstanding hash remains locked through transport errors and unknown outcomes. */
export function createGuardedSignerPort<T>(
  authority: VerifiedAuthority,
  deps: SignerDependencies<T>,
): SignerPort {
  let busy = false;
  let pending: string | null = null;
  let uncertain = false;
  return {
    async send(call) {
      if (busy || pending || uncertain) return { kind: "refused", reason: "request_unreconciled" };
      if (
        call.signerId !== authority.watcherAccountId ||
        call.receiverId !== authority.guardianId ||
        call.methodName !== REQUEST_METHOD ||
        call.gas !== REQUEST_GAS ||
        call.deposit !== 0n ||
        !/^[1-9][0-9]{0,38}$/.test(call.args.amount) ||
        BigInt(call.args.amount) > (1n << 128n) - 1n
      )
        return { kind: "refused", reason: "invalid_request" };
      if (!deps.submissionAllowed()) return { kind: "refused", reason: "submission_gate_closed" };
      busy = true;
      let signingStarted = false;
      try {
        if (!(await deps.verify())) return { kind: "refused", reason: "authority_unavailable" };
        signingStarted = true;
        await deps.journal?.begin(call);
        const result = await deps.sign(call);
        // After signing, uncertainty without a valid hash must propagate to the core's read-only lock.
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.hash))
          throw new Error("Signed hash unavailable");
        const hashBytes = baseDecode(result.hash);
        if (hashBytes.length !== 32 || baseEncode(hashBytes) !== result.hash)
          throw new Error("Signed hash unavailable");
        await deps.journal?.recordHash(result.hash);
        pending = result.hash;
        try {
          await deps.broadcast(result.signed);
        } catch {
          /* signed hash is retained */
        }
        return { kind: "pending", hash: result.hash };
      } catch {
        if (signingStarted && pending === null) uncertain = true;
        throw new Error("Watcher request could not be reconciled");
      } finally {
        await deps.journal?.close().catch(() => {});
        busy = false;
      }
    },
    async lookup(hash) {
      if (hash !== pending || busy) return { kind: "unknown" };
      busy = true;
      try {
        const result = await deps.lookup(hash).catch((): TxLookup => ({ kind: "unknown" }));
        if (result.kind === "final" && result.outcome.outcome === "unresolved")
          return { kind: "pending" };
        if (result.kind === "final") pending = null;
        if (result.kind === "failed") pending = null;
        return result;
      } finally {
        busy = false;
      }
    },
  };
}
