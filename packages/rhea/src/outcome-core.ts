import { isValidAccountId } from "@mrfund/shared";
import { object } from "./client";
import type { OutcomeError } from "./outcome-types";

/**
 * Validation primitives shared by every outcome parser (repay and opening). Moved unchanged out of
 * `outcome.ts`; each throws `InvalidOutcome` on malformed input, so a parser never trusts RPC data.
 */
export const OUTCOME_LIMITS = { transactions: 16, receipts: 512, depth: 64, text: 65_536 } as const;
export const U128_MAX = (1n << 128n) - 1n;
export class InvalidOutcome extends Error {
  constructor(
    readonly kind: OutcomeError["kind"],
    detail: string,
  ) {
    super(detail);
  }
}
export function fail(detail: string, kind: OutcomeError["kind"] = "bad_response"): never {
  throw new InvalidOutcome(kind, detail);
}
export function outcomeRecord(v: unknown): Record<string, unknown> {
  if (!object(v)) fail("Expected object");
  return v;
}
export function list(v: unknown, max: number = OUTCOME_LIMITS.receipts): unknown[] {
  if (!Array.isArray(v)) fail("Expected array");
  if (v.length > max) fail("Outcome size limit exceeded", "limit_exceeded");
  return v;
}
export function str(v: unknown): string {
  if (typeof v !== "string") fail("Expected string");
  if (v.length > OUTCOME_LIMITS.text) fail("Text limit exceeded", "limit_exceeded");
  return v;
}
export function hash(v: unknown): string {
  const s = str(v);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) fail("Invalid hash");
  return s;
}
export function account(v: unknown): string {
  const s = str(v);
  if (!isValidAccountId(s)) fail("Invalid account");
  return s;
}
export function outcomeAmount(v: unknown): bigint {
  const s = str(v);
  if (!/^(0|[1-9][0-9]{0,38})$/.test(s) || BigInt(s) > U128_MAX) fail("Invalid u128");
  return BigInt(s);
}
export function json(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail("Invalid JSON");
  }
}
export function decode(v: unknown): string {
  const s = str(v);
  if (s.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))
    fail("Invalid base64");
  try {
    const raw = atob(s);
    if (btoa(raw) !== s) fail("Noncanonical base64");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(raw, (c) => c.charCodeAt(0)),
    );
  } catch {
    return fail("Invalid base64 or UTF-8");
  }
}
export type Status =
  | { kind: "value"; value: string }
  | { kind: "receipt"; id: string }
  | { kind: "failure" | "unknown" };
export function status(v: unknown): Status {
  if (v === undefined) return { kind: "unknown" };
  if (v === "Unknown" || v === "NotStarted" || v === "Started") return { kind: "unknown" };
  const s = outcomeRecord(v);
  if (Object.keys(s).length !== 1) fail("Invalid execution status");
  if (s.SuccessValue !== undefined) return { kind: "value", value: decode(s.SuccessValue) };
  if (s.SuccessReceiptId !== undefined) return { kind: "receipt", id: hash(s.SuccessReceiptId) };
  if (object(s.Failure)) return { kind: "failure" };
  return fail("Invalid execution status");
}
export function functionCall(actions: unknown) {
  const a = list(actions, 1);
  if (a.length !== 1) fail("Expected one function call");
  const fc = outcomeRecord(outcomeRecord(a[0]).FunctionCall);
  return {
    method: str(fc.method_name),
    argsJson: decode(fc.args),
    deposit: outcomeAmount(fc.deposit),
  };
}

export interface Node {
  id: string;
  block: string;
  executor: string;
  children: string[];
  status: Status;
}
export function node(v: unknown): Node {
  const r = outcomeRecord(v),
    o = outcomeRecord(r.outcome),
    s = status(o.status);
  const children = list(o.receipt_ids).map(hash);
  if (new Set(children).size !== children.length) fail("Duplicate child receipt");
  if (s.kind === "receipt" && !children.includes(s.id)) children.push(s.id);
  return {
    id: hash(r.id),
    block: hash(r.block_hash),
    executor: account(o.executor_id),
    children,
    status: s,
  };
}
