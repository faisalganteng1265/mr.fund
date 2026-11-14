import { BarChart3, History, ShieldCheck } from "lucide-react";

export type DetailTab = "position" | "guardian" | "activity";
const tabs = [
  { id: "position", label: "Position", icon: BarChart3 },
  { id: "guardian", label: "Guardian", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: History },
] as const;

export function ConsultationTabs({
  value,
  onChange,
  activityCount,
}: {
  value: DetailTab;
  onChange: (tab: DetailTab) => void;
  activityCount: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Consultation details"
      className="grid grid-cols-3 gap-1 rounded-full border border-white/7 bg-[#1b1d1e] p-1"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`detail-tab-${tab.id}`}
          aria-controls="consultation-detail-panel"
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const target =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : null;
            const next = target === null ? undefined : tabs[target];
            if (!next) return;
            event.preventDefault();
            onChange(next.id);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
              [target ?? 0]?.focus();
          }}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full border-0 px-2 py-2 text-[11px] font-bold transition-colors ${value === tab.id ? "bg-[#e4d7ba] text-[#26352a]" : "bg-transparent text-[#a2a4a5] hover:bg-[#263847] hover:text-[#edf3f5]"}`}
        >
          <tab.icon size={15} />
          {tab.label}
          {tab.id === "activity" && activityCount > 0 && (
            <span className="rounded-full bg-[#ff643b] px-1.5 py-0.5 text-[9px] text-[#171b23]">
              {activityCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
