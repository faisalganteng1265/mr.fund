/**
 * Helpers shared by the agent's tools, moved unchanged out of `tools.ts` so a second tool file can
 * use them without a runtime import cycle (this file imports only types from `tools.ts`).
 */
import type { AssetState, Atomic, EngineError, PositionSnapshot } from "@mrfund/shared";
import { fromAtomic, type SourceNumber } from "./numbers";
import type { Fact, ToolResult } from "./tools";

export const refuse = (tool: string, code: string, message: string): ToolResult => ({
  ok: false,
  tool,
  refusal: { code, message },
});

export function engineRefusal(tool: string, e: EngineError): ToolResult {
  switch (e.kind) {
    case "stale_price":
      return refuse(
        tool,
        "stale_price",
        `Price data for ${e.tokenId} is older than the freshness limit, so no advice can be given.`,
      );
    case "missing_price":
      return refuse(tool, "missing_price", `No price is available for ${e.tokenId}.`);
    case "unsupported_asset":
      return refuse(tool, "unsupported_asset", `${e.tokenId} is not supported here.`);
    case "invalid_amount":
      return refuse(tool, "invalid_amount", e.reason);
    case "invalid_input":
      return refuse(tool, "invalid_input", e.reason);
    case "stale_snapshot":
      return refuse(
        tool,
        "stale_snapshot",
        "The position was read longer ago than the freshness limit, so no advice can be given.",
      );
    case "target_unreachable":
      return refuse(
        tool,
        "target_unreachable",
        "Repaying this token cannot reach the target health.",
      );
  }
}
export const invalid = (tool: string, message: string): ToolResult =>
  refuse(tool, "invalid_arguments", message);

/** Arguments must be an object with only the allowed keys; missing means empty. */
export function argsOf(raw: unknown, allowed: readonly string[]): Record<string, unknown> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "arguments must be an object";
  const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return `unexpected argument: ${extra.join(", ")}`;
  return raw as Record<string, unknown>;
}
export const fact = (label: string, s: SourceNumber): Fact => ({
  label,
  value: s.value,
  unit: s.unit,
});

export const dataAgeFact = (ms: number): Fact =>
  fact("data age", fromAtomic(BigInt(Math.max(0, Math.floor(ms))), 3, "s"));

export function resolveAsset(s: PositionSnapshot, ref: string): AssetState | undefined {
  const byId = s.assets[ref];
  if (byId) return byId;
  const lower = ref.toLowerCase();
  return Object.values(s.assets).find((a) => a.token.symbol.toLowerCase() === lower);
}

/** A whole-unit decimal amount ("50", "0.5") to token atomic units, or an error message. */
export function parseAmount(v: unknown, decimals: number): Atomic | string {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s))
    return "amount must be a positive decimal number";
  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > decimals) return `amount has more than ${decimals} decimal places`;
  return BigInt(whole + frac.padEnd(decimals, "0"));
}
