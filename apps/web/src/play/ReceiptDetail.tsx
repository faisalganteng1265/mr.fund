import { AlertTriangle, ArrowRight, BadgeCheck } from "lucide-react";
import { ModalFrame } from "./ModalFrame";
import { ProvenanceTag } from "./ProvenanceTag";
import type { Port, Receipt } from "./source/types";
import { playClasses } from "./styles";

interface Props {
  receipt: Receipt;
  port: Port;
  close: () => void;
  openActivity: () => void;
}
export function ReceiptDetail({ receipt, port, close, openActivity }: Props) {
  return (
    <ModalFrame
      eyebrow="A RECORD, NOT A PROMISE"
      title={port.provenance === "simulated" ? "Your demo receipt." : "Your receipt."}
      close={() => close()}
    >
      <div className={playClasses(`receipt-banner ${receipt.status}`)}>
        <span>
          {receipt.status === "confirmed" ? <BadgeCheck size={27} /> : <AlertTriangle size={27} />}
        </span>
        <div>
          <b>{receipt.title}</b>
          <small>
            {receipt.status.toUpperCase()} ·{" "}
            {port.provenance === "simulated" && (
              <>
                <ProvenanceTag port={port} label="SIMULATED" /> ·{" "}
              </>
            )}
            {receipt.at}
          </small>
        </div>
      </div>
      <p className="modal-copy text-[12px] leading-[1.8] text-[#a2a4a5] m-[20px_0]! max-[620px]:text-[11px]">
        {receipt.detail}
      </p>
      {receipt.before && (
        <div className="receipt-health flex items-center justify-between [border:1px_solid_#313334] rounded-[8px] p-[14px_12px] gap-[10px] [&>span]:text-[10px] [&>span]:text-[#a2a4a5] [&_b]:flex [&_b]:gap-[8px] [&_b]:items-center [&_b]:font-[family-name:var(--font-display)] [&_b]:text-[15px] max-[620px]:p-[12px_9px] max-[620px]:[&>span]:text-[8px] max-[620px]:[&_b]:text-[13px]">
          <span>Position health</span>
          <b>
            {receipt.before}
            <ArrowRight size={18} />
            {receipt.after}
          </b>
        </div>
      )}
      <div className="receipt-metadata mt-[16px] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:p-[12px_0] [&>div]:[border-bottom:1px_solid_#313334] [&>div]:text-[10px] [&_span]:text-[#a2a4a5] [&_b]:text-[9px] [&~.button]:mt-[22px]">
        <div>
          <span>Reference</span>
          <b>
            {port.provenance === "simulated"
              ? `DEMO-${String(receipt.id).padStart(4, "0")}`
              : String(receipt.id)}
          </b>
        </div>
        <div>
          <span>Network</span>
          <b>{port.provenance === "simulated" ? "Local simulation" : port.networkLabel}</b>
        </div>
        <div>
          <span>Transaction hash</span>
          <b>{receipt.chain.txHashes.join(", ") || "Not submitted"}</b>
        </div>
      </div>
      {port.provenance === "simulated" && (
        <p className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
          No explorer link: this is a local UI simulation. The result is computed from the updated
          demo fixture, not observed on-chain.
        </p>
      )}
      <button
        type="button"
        className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] blue-button bg-[var(--blue)] text-[#203327]! [&:hover]:bg-[#a7c8b1] full-width w-full"
        onClick={openActivity}
      >
        View all activity <ArrowRight size={16} />
      </button>
    </ModalFrame>
  );
}
