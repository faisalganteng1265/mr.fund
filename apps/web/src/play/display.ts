import { decimalString } from "@mrfund/shared";

export function amount(value: bigint, digits = 2): string {
  const [whole = "0", fraction = ""] = decimalString(value, 6).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${digits ? `.${fraction.padEnd(digits, "0").slice(0, digits)}` : ""}`;
}
export function percent(bps: number | "no_debt"): string {
  return bps === "no_debt" ? "No debt" : `${(bps / 100).toFixed(2)}%`;
}
