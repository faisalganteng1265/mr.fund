import { Play } from "lucide-react";
import { amount } from "./display";
import { ProvenanceTag } from "./ProvenanceTag";
import type { GuardianView, OwnerAction, Port } from "./source/types";

interface Props
  extends Pick<
    GuardianView,
    "guardian" | "guardianSpent" | "savedFields" | "remaining" | "guardianDebt" | "watcherOnline"
  > {
  ownerAction: (action: OwnerAction) => void;
  replay: (overLimit: boolean) => void;
  port: Port;
}
export function GuardianDetails({
  guardian,
  guardianSpent,
  savedFields,
  remaining,
  guardianDebt,
  watcherOnline,
  ownerAction,
  replay,
  port,
}: Props) {
  return (
    <div
      data-panel-enter="4"
      className="guardian-details mt-[24px] [border-top:1px_solid_#ffffff14] pt-[20px] [&_.fine-print]:text-[#a2a4a5] [&_.fine-print]:text-[10px]"
    >
      <div className="detail-grid grid grid-cols-[1fr_1fr] gap-[23px_18px] [&_small]:text-[9px] [&_small]:text-[#a2a4a5] [&_small]:block [&_b]:text-[10px] [&_b]:block [&_b]:leading-[1.7] [&_b]:mt-[6px] [&_b]:font-bold [&_span]:text-[8px] [&_span]:block [&_span]:leading-[1.7] [&_span]:text-[#a2a4a5] max-[620px]:gap-[20px_13px] max-[620px]:[&_b]:text-[9px] max-[620px]:[&_small]:text-[8px]">
        <div>
          <small>Lifetime spent / cap</small>
          <b>
            {amount(guardianSpent)} / {savedFields.cap} USDC
          </b>
        </div>
        <div>
          <small>Remaining lifetime budget</small>
          <b>{amount(remaining)} USDC</b>
        </div>
        <div>
          <small>Target health / cooldown</small>
          <b>
            {savedFields.target || "Not set"}% / {savedFields.cooldown} min
          </b>
        </div>
        <div>
          <small>Fees / recipient</small>
          <b>1 USDC activation · 0 per action</b>
          <span>fees.demo.testnet</span>
        </div>
        <div>
          <small>Protected debt / allowed action</small>
          <b>{amount(guardianDebt)} USDC · Repay only</b>
        </div>
        <div>
          <small>Watcher heartbeat</small>
          <b>
            {watcherOnline ? "Online" : "Offline"}
            {port.provenance === "simulated" && (
              <>
                {" "}
                · <ProvenanceTag port={port} label="simulated" />
              </>
            )}
          </b>
        </div>
      </div>
      <p className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
        {port.provenance === "simulated"
          ? "Demo model: G1 Guardian-held loan. This does not transfer your existing wallet position. No contract is deployed. Fast markets, stale data, insufficient reserve and watcher downtime can still lead to liquidation."
          : "Guardian-held loan. This does not transfer your existing wallet position. Fast markets, stale data, insufficient reserve and watcher downtime can still lead to liquidation."}
      </p>
      <div className="replay-actions flex flex-wrap items-center gap-[10px] mt-[18px]">
        {port.provenance === "simulated" && (
          <>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border-0 bg-[#bad7c3] px-4 py-2.5 text-xs font-semibold text-[#203327] transition-colors hover:bg-[#d3e5d7]"
              onClick={() => replay(false)}
            >
              <Play size={14} />
              Run simulated trigger
            </button>
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-transparent px-4 py-2.5 text-xs font-medium text-[#c5cec7] transition-colors hover:bg-[#292d2b]"
              onClick={() => replay(true)}
            >
              Test over-limit rejection
            </button>
          </>
        )}
        {guardian !== "deactivated" && (
          <button
            type="button"
            className="text-button bg-transparent border-0 text-[10px]! font-extrabold! inline-flex items-center gap-[9px] danger-text text-[#ffb18c]! p-[7px_0]"
            onClick={() => ownerAction("deactivate")}
          >
            Deactivate Guardian
          </button>
        )}
      </div>
      <small className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
        {port.provenance === "simulated"
          ? "Replays and rejections run locally. They are not on-chain evidence."
          : null}
      </small>
    </div>
  );
}
