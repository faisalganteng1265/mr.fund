import { isValidAccountId } from "@mrfund/shared";
import { record } from "../transport";

export interface PositionSelectors {
  accountId: string;
  networkId: "testnet" | "mainnet";
}
/** JSON token scanning preserves duplicate keys, including escaped spellings lost by JSON.parse. */
export function parsePositionSelectors(raw: string | URLSearchParams): PositionSelectors {
  let value: unknown;
  if (typeof raw === "string") {
    value = JSON.parse(raw) as unknown;
    const keys = new Set<string>();
    for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (
        !raw
          .slice((token.index ?? 0) + token[0].length)
          .trimStart()
          .startsWith(":")
      )
        continue;
      const key = JSON.parse(token[0]) as string;
      if (keys.has(key)) throw new Error("Duplicate selector");
      keys.add(key);
    }
  } else {
    const keys = [...raw.keys()];
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate selector");
    value = Object.fromEntries(raw);
  }
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "accountId") ||
    !Object.hasOwn(value, "networkId") ||
    typeof value.accountId !== "string" ||
    !isValidAccountId(value.accountId) ||
    (value.networkId !== "testnet" && value.networkId !== "mainnet")
  )
    throw new Error("Invalid selectors");
  return { accountId: value.accountId, networkId: value.networkId };
}
