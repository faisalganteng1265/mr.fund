import type { LivePositionState } from "../source/livePosition";

/** A chip either sends a question through the normal chat path or refreshes the position. */
export type Suggestion =
  | { label: string; action: "send"; text: string }
  | { label: string; action: "refresh" };

const ask = (text: string): Suggestion => ({ label: text, action: "send", text });
const refresh: Suggestion = { label: "Refresh position", action: "refresh" };

const concepts = [
  ask("What is health factor?"),
  ask("How does Guardian work?"),
  ask("What can you do?"),
];

/**
 * Chips for the current live state. No position: concepts only, never a repay. Stale or
 * unavailable data: refresh first. A failed turn keeps only the refresh chip; Retry lives in the
 * error message itself.
 */
export function liveSuggestions(
  status: LivePositionState["status"],
  failedTurn: boolean,
): Suggestion[] {
  if (status === "loading" || status === "network_mismatch") return [];
  if (status === "empty") return concepts;
  if (status === "stale") return [refresh, concepts[0] as Suggestion];
  if (status === "unavailable") return [refresh, concepts[2] as Suggestion];
  if (failedTurn) return [refresh];
  return [ask("Explain my position"), ask("What if NEAR drops 20%?"), ask("Should I repay?")];
}
