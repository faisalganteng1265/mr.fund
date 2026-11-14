import { ArrowUpRight, Pause, Play, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { amount } from "./display";
import { GuardianDetails } from "./GuardianDetails";
import { ProvenanceTag } from "./ProvenanceTag";
import type { GuardianView, OwnerAction, Port } from "./source/types";

interface Props {
  view: GuardianView;
  port: Port;
  ownerAction: (action: OwnerAction) => void;
  replay: (overLimit: boolean) => void;
  setup: () => void;
}
export function GuardianPanel({ view, port, ownerAction, replay, setup }: Props) {
  const { guardian, reserve, spendable, savedFields } = view;
  return (
    <section className="guardian-card min-w-0 overflow-hidden rounded-[24px] border border-white/8 bg-[#1f2122] p-5 text-[#edf3f5] sm:p-6">
      <div data-panel-enter="0" className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[#c7d7ca]">
          <ShieldCheck size={18} strokeWidth={1.6} />
          Guardian
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-[#292d2b] px-2.5 py-1 text-[10px] text-[#aeb8b1]">
          <span
            className={`size-1 rounded-full ${guardian === "active" ? "bg-[#bad7c3]" : "bg-[#818a85]"}`}
          />
          {guardian === "inactive"
            ? "Not configured"
            : guardian === "active"
              ? port.provenance === "simulated"
                ? "Active · demo"
                : "Active"
              : guardian === "paused"
                ? port.provenance === "simulated"
                  ? "Paused · demo"
                  : "Paused"
                : "Deactivated"}
        </span>
      </div>
      <div data-panel-enter="1" className="pb-6 pt-7">
        <h2 className="font-[family-name:var(--font-display)] text-[30px] font-medium leading-[1.12] tracking-[-1px]">
          {guardian === "inactive" ? (
            <>
              Your rules.
              <br />
              Your Guardian.
            </>
          ) : guardian === "active" ? (
            "Your policy, at a glance."
          ) : guardian === "paused" ? (
            "Paused. On your terms."
          ) : (
            "Your policy is off."
          )}
        </h2>
        <p className="mt-3! text-[12px] leading-[1.8] text-[#9da6a1]">
          {guardian === "inactive"
            ? "Choose when to repay and how much. Review every limit before you switch it on."
            : `Reserve ${amount(reserve)} USDC · Spendable ${amount(spendable)} USDC. ${port.provenance === "simulated" ? "A separate, simulated Guardian-held loan." : "A separate Guardian-held loan."}`}
        </p>
      </div>
      {guardian === "inactive" ? (
        <div>
          <div data-panel-enter="2" className="mb-6 space-y-4">
            <div className="flex items-start gap-3">
              <SlidersHorizontal size={16} strokeWidth={1.6} className="mt-0.5 text-[#aabeb0]" />
              <div>
                <p className="text-[12px] font-medium text-[#d5ddd7]">Limits you choose</p>
                <p className="mt-1! text-[11px] leading-relaxed text-[#858f89]">
                  Repayment cap, reserve and trigger.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Pause size={16} strokeWidth={1.6} className="mt-0.5 text-[#aabeb0]" />
              <div>
                <p className="text-[12px] font-medium text-[#d5ddd7]">Control stays with you</p>
                <p className="mt-1! text-[11px] leading-relaxed text-[#858f89]">
                  Pause or change your policy.
                </p>
              </div>
            </div>
          </div>
          <button
            data-panel-enter="3"
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-full border-0 bg-[#bad7c3] px-4 py-3 text-[12px] font-semibold text-[#203327] transition-colors hover:bg-[#d3e5d7]"
            onClick={setup}
          >
            Meet your Guardian <ArrowUpRight size={17} />
          </button>
          <p data-panel-enter="4" className="mt-3! text-center text-[10px] text-[#808c84]">
            <ProvenanceTag port={port} label="Opt-in · Simulated policy preview" />
          </p>
        </div>
      ) : (
        <>
          <div
            data-panel-enter="2"
            className="guardian-numbers grid grid-cols-[repeat(3,1fr)] m-[13px_0] [border-top:1px_solid_#ffffff14] pt-[15px] gap-[12px] [&_small]:block [&_small]:text-[10px] [&_small]:text-[#a2a4a5] [&_small]:tracking-[.05em] [&_strong]:font-[family-name:var(--font-display)] [&_strong]:text-[23px] [&_strong]:font-medium [&_strong]:block [&_strong]:mt-[4px] [&_em]:[font:10px_var(--font-body)] max-[620px]:gap-[8px] max-[620px]:[&_small]:text-[9px] max-[620px]:[&_strong]:text-[22px] max-[620px]:[&_em]:text-[9px]"
          >
            <div>
              <small>PER ACTION</small>
              <strong>
                {savedFields.max}
                <em> USDC</em>
              </strong>
            </div>
            <div>
              <small>RESERVE FLOOR</small>
              <strong>
                {savedFields.floor}
                <em> USDC</em>
              </strong>
            </div>
            <div>
              <small>TRIGGER BELOW</small>
              <strong>
                {savedFields.trigger}
                <em>%</em>
              </strong>
            </div>
          </div>
          <div
            data-panel-enter="3"
            className="guardian-controls flex gap-[8px] items-center mt-[17px] flex-wrap [&>.icon-button]:ml-auto"
          >
            {guardian !== "deactivated" && (
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border-0 bg-[#bad7c3] px-4 py-2.5 text-xs font-semibold text-[#203327] transition-colors hover:bg-[#d3e5d7]"
                onClick={() => ownerAction(guardian === "active" ? "pause" : "resume")}
              >
                {guardian === "active" ? <Pause size={15} /> : <Play size={15} />}
                {guardian === "active" ? "Pause" : "Resume"}
              </button>
            )}
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-xs font-medium text-[#c5cec7] transition-colors hover:bg-[#292d2b]"
              onClick={() => ownerAction("withdraw")}
            >
              Withdraw
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-xs font-medium text-[#c5cec7] transition-colors hover:bg-[#292d2b]"
              onClick={() => ownerAction("topup")}
            >
              <Plus size={15} />
              Top up
            </button>
          </div>
        </>
      )}
      {guardian !== "inactive" && (
        <GuardianDetails {...view} ownerAction={ownerAction} replay={replay} port={port} />
      )}
    </section>
  );
}
