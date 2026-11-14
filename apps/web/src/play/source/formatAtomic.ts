/** Format atomic units exactly, without rounding or converting money to Number. */
export function formatAtomic(value: string | bigint, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 38)
    throw new RangeError("Invalid token decimals");
  const raw = typeof value === "bigint" ? value.toString() : value;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new RangeError("Invalid atomic amount");
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
