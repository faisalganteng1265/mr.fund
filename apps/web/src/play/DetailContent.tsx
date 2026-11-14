import type { ReactNode } from "react";

/** A keyed mount replays the cascade only when the selected tool changes. */
export function DetailContent({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&_[data-panel-enter]]:transition-[opacity,translate] [&_[data-panel-enter]]:duration-400 [&_[data-panel-enter]]:ease-[cubic-bezier(.22,1,.36,1)] starting:[&_[data-panel-enter]]:-translate-y-3 starting:[&_[data-panel-enter]]:opacity-0 [&_[data-panel-enter='1']]:delay-[45ms] [&_[data-panel-enter='2']]:delay-[90ms] [&_[data-panel-enter='3']]:delay-[135ms] [&_[data-panel-enter='4']]:delay-[180ms] [&_[data-panel-enter='5']]:delay-[225ms] motion-reduce:[&_[data-panel-enter]]:transition-none">
      {children}
    </div>
  );
}
