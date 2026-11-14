/**
 * The chat route serializes bigint values as decimal strings (`handler.ts`). Before a streamed
 * card can be verified, the exact fields that are bigint in `Card` are restored: each action's
 * `gas` and `deposit` and each fee line's `amount`. Anything malformed refuses the whole card;
 * nothing is coerced, rounded or defaulted. Every other field is checked by the verifier.
 */
import type { Card } from "@mrfund/shared";

const U128_TEXT = /^(0|[1-9]\d{0,38})$/;
const big = (v: unknown): bigint | null =>
  typeof v === "string" && U128_TEXT.test(v) ? BigInt(v) : typeof v === "bigint" ? v : null;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function decodeWireCard(value: unknown): Card | null {
  const c = record(value);
  if (!c || typeof c.id !== "string" || !Array.isArray(c.payload) || !Array.isArray(c.fees))
    return null;
  const payload = [];
  for (const tx of c.payload) {
    const t = record(tx);
    if (!t || !Array.isArray(t.actions)) return null;
    const actions = [];
    for (const action of t.actions) {
      const a = record(action);
      if (!a) return null;
      const gas = big(a.gas);
      const deposit = big(a.deposit);
      if (gas === null || deposit === null) return null;
      actions.push({ ...a, gas, deposit });
    }
    payload.push({ ...t, actions });
  }
  const fees = [];
  for (const fee of c.fees) {
    const f = record(fee);
    const amount = f ? big(f.amount) : null;
    if (!f || amount === null) return null;
    fees.push({ ...f, amount });
  }
  return { ...c, payload, fees } as unknown as Card;
}
