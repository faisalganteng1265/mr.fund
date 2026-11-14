import { ArrowRight, ArrowUpRight, ChevronDown, SlidersHorizontal, X, Zap } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { amount } from "./display";
import { Tag } from "./ProvenanceTag";
import type { Advice } from "./source/types";

interface Props extends Pick<Advice, "card" | "comp"> {
  repayAmount: string;
  adjusting: boolean;
  unavailable: boolean;
  setRepayAmount: (value: string) => void;
  setAdjusting: Dispatch<SetStateAction<boolean>>;
  setCardOpen: (open: boolean) => void;
  executeCard: () => void;
  refresh: () => void;
}
export function RecommendationCard({
  card,
  comp,
  repayAmount,
  adjusting,
  unavailable,
  setRepayAmount,
  setAdjusting,
  setCardOpen,
  executeCard,
  refresh,
}: Props) {
  return (
    <div className="recommendation-card bg-[#1c1e1f] [border:1px_solid_#313334] rounded-[12px] p-[15px] m-[12px_0] [&_h3]:font-[family-name:var(--font-display)] [&_h3]:text-[24px] [&_h3]:tracking-[-.9px] [&_h3]:m-[5px_0] [&>p]:text-[10px] [&>p]:text-[#a2a4a5] [&>p]:mb-[15px] [&_details]:[border-top:1px_solid_#313334] [&_details]:pt-[10px] [&_details]:text-[8px] [&_details]:text-[#a2a4a5] [&_summary]:flex [&_summary]:items-center [&_summary]:justify-between [&_summary]:cursor-pointer [&_summary]:font-semibold [&_details_p]:mt-[10px] [&_details_p]:leading-[1.7]">
      <div className="recommendation-heading flex items-center justify-between [&_.tag]:border-0 [&_.tag]:text-[var(--blue)] [&_.tag]:bg-[#1c1e1f] [&_.tag]:pl-[0]">
        <Tag>
          <Zap size={12} />
          THE SMARTER MOVE
        </Tag>
        <button
          type="button"
          className="icon-button inline-flex items-center justify-center border-0 bg-transparent w-[32px] h-[32px] rounded-full p-0 [transition:background_.18s] [&:hover]:bg-[#8080801a]"
          aria-label="Dismiss recommendation"
          onClick={() => setCardOpen(false)}
        >
          <X size={16} />
        </button>
      </div>
      <h3>{card?.ok ? card.value.headline : "Refresh before your next move"}</h3>
      {card?.ok ? (
        <>
          <p>Less debt. Less interest. More breathing room.</p>
          <div className="comparison-bars flex flex-col gap-[12px] m-[18px_0] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:flex-wrap [&>div]:gap-[5px] [&>div]:text-[8px] [&>div]:text-[#a2a4a5] [&_b]:text-[9px] [&_b]:text-[var(--ink)] [&_i]:block [&_i]:basis-[100%] [&_i]:h-[7px] [&_i]:rounded-[3px] [&_.repay-bar]:bg-[var(--blue)] [&_.yield-bar]:bg-[#1c1e1f] [&_.yield-bar]:max-w-[66.7%]">
            <div>
              <span>Repay · avoided interest</span>
              <b>{comp.ok ? amount(comp.value.value.repaySaves) : "—"} USDC / yr</b>
              <i className="repay-bar" />
            </div>
            <div>
              <span>Supply · estimated yield</span>
              <b>{comp.ok ? amount(comp.value.value.yieldEarns) : "—"} USDC / yr</b>
              <i className="yield-bar" />
            </div>
          </div>
          <div className="card-number-list tabular-nums [border-top:1px_solid_#313334] p-[6px_0] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:p-[7px_0] [&>div]:gap-[10px] [&>div]:text-[8px] [&_span]:text-[#a2a4a5] [&_b]:flex [&_b]:items-center [&_b]:gap-[6px] [&_b]:font-bold [&_b]:text-[9px] [&_small]:text-[7px] [&_small]:text-[#a2a4a5]">
            {card.value.numbers.map((n) => (
              <div key={n.label}>
                <span>{n.label}</span>
                <b>
                  {n.before} <ArrowRight size={12} />
                  {n.after ?? "—"} <small>{n.unit}</small>
                </b>
              </div>
            ))}
          </div>
          {adjusting && (
            <label className="adjust-field flex flex-col text-[9px] gap-[7px] m-[12px_0] [&_input]:bg-[#101923] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[6px] [&_input]:p-[10px] [&_input]:w-full [&_input]:text-[12px]">
              Repay amount (USDC)
              <input
                type="number"
                min="0.000001"
                step="0.01"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
              />
            </label>
          )}
          <details>
            <summary>
              Why this? Assumptions, fees & risks <ChevronDown size={13} />
            </summary>
            <p>
              Both rates are illustrative APRs, estimated linearly for 365 days without compounding.
              Borrow 21.00%; supply 14.01%. Demo input age: fresh.{" "}
              {card.value.cappedBy ? `Amount capped by ${card.value.cappedBy}.` : ""}
            </p>
            <p>
              Execution fee: 0.10 test USDC → fees.demo.testnet, charged on mock approval. Rates
              change. Repayment reduces liquidation risk within your limits; it cannot remove it.
            </p>
            {card.value.assumptions.map((a) => (
              <p key={a}>{a}</p>
            ))}
          </details>
          <div className="card-actions flex gap-[9px] mt-[16px] [&>button]:flex-1 [&>button]:justify-center">
            <button
              type="button"
              className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40] small"
              onClick={() => setAdjusting((v) => !v)}
            >
              <SlidersHorizontal size={14} />
              Adjust
            </button>
            <button
              type="button"
              className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] blue-button bg-[var(--blue)] text-[#203327]! [&:hover]:bg-[#a7c8b1] small"
              onClick={executeCard}
              disabled={unavailable}
            >
              Execute now <ArrowUpRight size={15} />
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {unavailable
              ? "Fresh position data is needed. Execute is blocked."
              : "Enter a positive amount. Your wallet must cover the repayment and its fee."}
          </p>
          {adjusting && (
            <label className="adjust-field flex flex-col text-[9px] gap-[7px] m-[12px_0] [&_input]:bg-[#101923] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[6px] [&_input]:p-[10px] [&_input]:w-full [&_input]:text-[12px]">
              Repay amount (USDC)
              <input
                type="number"
                min="0.000001"
                step="0.01"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40] small"
            onClick={unavailable ? refresh : () => setAdjusting(true)}
          >
            {unavailable ? "Refresh position" : "Adjust amount"}
          </button>
        </>
      )}
    </div>
  );
}
