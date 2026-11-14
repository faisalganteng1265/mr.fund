import { promptGridClass } from "../chatAppearance";
import type { Suggestion } from "./liveSuggestions";

/** The demo's chip look at its readable size, before and after the first question. */
export function SuggestionChips({
  suggestions,
  onSend,
  onRefresh,
}: {
  suggestions: Suggestion[];
  /** `byKeyboard` is true for Enter/Space, so the parent can keep keyboard focus from falling to the page. */
  onSend: (text: string, byKeyboard: boolean) => void;
  onRefresh: (byKeyboard: boolean) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and default styling to plain chips
    <div role="group" aria-label="Suggested questions" aria-live="off" className={promptGridClass}>
      {suggestions.map((s) => (
        <button
          type="button"
          key={s.label}
          onClick={(event) =>
            s.action === "send" ? onSend(s.text, event.detail === 0) : onRefresh(event.detail === 0)
          }
        >
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}
