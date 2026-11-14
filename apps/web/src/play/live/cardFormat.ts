import type { PositionView } from "@mrfund/server/position";
import { formatAtomic } from "../source/formatAtomic";

type Balances = Pick<PositionView, "supplied" | "collateral" | "debt">;
interface Fee {
  amount: bigint | string;
  tokenId: string;
}

/**
 * A fee in whole token units when the live position tells us the token's decimals, otherwise the
 * exact atomic amount. Exact decimal string arithmetic only: the value never goes through a float.
 */
export function feeAmountText(fee: Fee, position: Balances | null): string {
  const atomic = String(fee.amount);
  const token = position
    ? [...position.supplied, ...position.collateral, ...position.debt].find(
        (b) => b.tokenId === fee.tokenId,
      )
    : undefined;
  if (!token) return `${atomic} atomic units of ${fee.tokenId}`;
  try {
    return `${formatAtomic(atomic, token.decimals)} ${token.symbol}`;
  } catch {
    return `${atomic} atomic units of ${fee.tokenId}`;
  }
}
