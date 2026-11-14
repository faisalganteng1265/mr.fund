import { ArrowRight, ChevronDown, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Tag } from "../ProvenanceTag";
import type { useLiveConsultation } from "../useLiveConsultation";
import { feeAmountText } from "./cardFormat";
import { useDataAge } from "./dataAge";

type Live = ReturnType<typeof useLiveConsultation>;
type Card = NonNullable<Live["card"]>;

const TAG: Record<Card["action"], string> = {
  repay: "REPAY",
  wallet_collateral_deposit: "DEPOSIT",
  wallet_borrow: "BORROW",
  guardian_activate: "GUARDIAN",
  guardian_deactivate: "GUARDIAN",
  guardian_withdraw: "GUARDIAN",
};

/** Cards arrive over the network; a missing list renders as empty rather than crashing the chat. */
const list = <T,>(value: readonly T[] | undefined): readonly T[] =>
  Array.isArray(value) ? value : [];

export function DataAgeLabel({ ageMs, token }: { ageMs: number; token: object }) {
  const text = useDataAge(ageMs, token);
  // aria-live off: the label ticks every second and must not be re-announced inside the chat log.
  return (
    <span aria-live="off" className="tabular-nums text-[10px] text-[#a2a4a5]">
      {text}
    </span>
  );
}

/** Live card in the demo card layout. Every number, unit and fee comes from the card itself. */
export function LiveCard({
  card,
  position,
  children,
}: {
  card: Card;
  position: Parameters<typeof feeAmountText>[1];
  children: ReactNode;
}) {
  return (
    <article
      aria-label={card.headline}
      className="recommendation-card bg-[#1c1e1f] [border:1px_solid_#313334] rounded-[12px] p-[15px] m-[12px_0] [&_h3]:font-[family-name:var(--font-display)] [&_h3]:text-[24px] [&_h3]:tracking-[-.9px] [&_h3]:m-[5px_0] [&_details]:[border-top:1px_solid_#313334] [&_details]:pt-[10px] [&_details]:text-[11px] [&_details]:text-[#a2a4a5] [&_summary]:flex [&_summary]:items-center [&_summary]:justify-between [&_summary]:cursor-pointer [&_summary]:font-semibold [&_details_p]:mt-[10px] [&_details_p]:leading-[1.7]"
    >
      <div className="recommendation-heading flex items-center justify-between gap-3 [&_.tag]:border-0 [&_.tag]:text-[var(--blue)] [&_.tag]:bg-[#1c1e1f] [&_.tag]:pl-[0]">
        <Tag>
          <Zap size={12} aria-hidden="true" />
          {TAG[card.action]}
        </Tag>
        <DataAgeLabel ageMs={card.dataAgeMs} token={card} />
      </div>
      <h3>{card.headline}</h3>
      <p className="mb-[15px] text-[12px] leading-[1.6] text-[#a2a4a5]">{card.reason}</p>
      <dl className="card-number-list tabular-nums [border-top:1px_solid_#313334] p-[6px_0]">
        {list(card.numbers).map((n) => (
          <div
            key={`${n.label}-${n.unit}`}
            className="flex items-center justify-between gap-[10px] p-[7px_0] text-[11px]"
          >
            <dt className="text-[#a2a4a5]">{n.label}</dt>
            <dd className="flex items-center gap-[6px] text-[12px] font-bold">
              {n.before}
              {n.before !== undefined && n.after !== undefined && (
                <ArrowRight size={12} aria-label="to" />
              )}
              {n.after}
              <small className="text-[10px] font-normal text-[#a2a4a5]">{n.unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>
          Assumptions, fees & risks <ChevronDown size={13} aria-hidden="true" />
        </summary>
        {list(card.fees).map((fee) => (
          <p key={`${fee.label}-${fee.recipientId}`}>
            {fee.label}: {feeAmountText(fee, position)} to {fee.recipientId} ({fee.when})
          </p>
        ))}
        {list(card.assumptions).map((a) => (
          <p key={a}>{a}</p>
        ))}
        {list(card.risks).map((r) => (
          <p key={r}>{r}</p>
        ))}
        {list(card.payload).map((tx, index) => (
          // A repay card holds several transactions to one token (repay and fee), so the receiver
          // alone repeats. The payload is a fixed list, so its position is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: static ordered payload, receivers repeat
          <p key={`${index}:${tx.receiverId}`}>
            To {tx.receiverId}: {tx.actions.map((action) => action.methodName).join(", ")}
          </p>
        ))}
      </details>
      <div className="mt-[16px] space-y-2">{children}</div>
    </article>
  );
}
