import type { PositionView } from "@mrfund/server/position";
import { percent } from "../display";
import { formatAtomic } from "../source/formatAtomic";
import type { LivePositionState } from "../source/livePosition";

export interface LiveHeaderStats {
  health: string;
  debt: string;
}

const NONE = "—";

/**
 * Header figures from the live read only. Absent, stale or no-debt positions show a dash, never
 * a fixture value. Debt is listed per token in its own units; adding tokens into one dollar
 * figure would need prices this layer does not have.
 */
export function liveHeaderStats(state: LivePositionState): LiveHeaderStats {
  if (state.status !== "ready") return { health: NONE, debt: NONE };
  const position: PositionView = state.position;
  const debts = position.debt.filter((b) => b.atomic !== "0");
  return {
    health: position.health.kind === "value" ? percent(position.health.bps) : NONE,
    debt: debts.length
      ? debts.map((b) => `${formatAtomic(b.atomic, b.decimals)} ${b.symbol}`).join(", ")
      : NONE,
  };
}
