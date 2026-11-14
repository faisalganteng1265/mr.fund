import { type Atomic, type EngineError, err, ok, type Result } from "./errors";
import type { Price } from "./snapshot";

function assertAmount(n: bigint): void {
  if (n < 0n) throw new RangeError("amount must not be negative");
}

function assertDecimals(d: number): void {
  if (!Number.isInteger(d) || d < 0)
    throw new RangeError("decimals must be a non-negative integer");
}

/** Token atomic units to Rhea internal units (`atomic * 10^extraDecimals`). */
export function toInternal(atomic: Atomic, extraDecimals: number): Atomic {
  assertAmount(atomic);
  assertDecimals(extraDecimals);
  return atomic * 10n ** BigInt(extraDecimals);
}

/** Rhea internal units to token atomic units. Floors: never reports more than exists. */
export function toAtomic(internal: Atomic, extraDecimals: number): Atomic {
  assertAmount(internal);
  assertDecimals(extraDecimals);
  return internal / 10n ** BigInt(extraDecimals);
}

/** Token amounts are u128 on chain. */
const U128_MAX = 2n ** 128n - 1n;

const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Parse untrusted text into atomic units. Only canonical non-negative integers pass. */
export function parseAtomic(s: string): Result<Atomic, EngineError> {
  if (!CANONICAL_INTEGER.test(s)) {
    return err({ kind: "invalid_amount", reason: "expected a non-negative whole number" });
  }
  const v = BigInt(s);
  if (v > U128_MAX)
    return err({ kind: "invalid_amount", reason: "amount exceeds the largest u128" });
  return ok(v);
}

/** Display only. Splits with bigint arithmetic so no digits are lost to floating point. */
export function formatUnits(atomic: Atomic, decimals: number, locale: string): string {
  assertAmount(atomic);
  assertDecimals(decimals);
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const wholeText = new Intl.NumberFormat(locale, { useGrouping: true }).format(whole);
  if (fraction === "") return wholeText;
  const decimalSeparator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ??
    ".";
  return `${wholeText}${decimalSeparator}${fraction}`;
}

/** Exact decimal text for `atomic / 10^decimals`; trailing zeros dropped. Not localized. */
export function decimalString(atomic: Atomic, decimals: number): string {
  assertAmount(atomic);
  assertDecimals(decimals);
  if (decimals > 77) throw new RangeError("decimals must not exceed 77");
  const s = atomic.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/** USD per whole token, exact. A price is `multiplier / 10^decimals` USD per atomic unit. */
export function usdPerWholeToken(price: Price, tokenDecimals: number): string {
  if (price.decimals >= tokenDecimals) {
    return decimalString(price.multiplier, price.decimals - tokenDecimals);
  }
  return (price.multiplier * 10n ** BigInt(tokenDecimals - price.decimals)).toString();
}
