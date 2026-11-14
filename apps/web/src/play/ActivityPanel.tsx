import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCheck, History } from "lucide-react";
import { ProvenanceTag, Tag } from "./ProvenanceTag";
import type { Port, Receipt } from "./source/types";
import { playClasses } from "./styles";

interface Props {
  receipts: Receipt[];
  port: Port;
  setSelectedReceipt: (receipt: Receipt | null) => void;
  sendMessage: (text: string) => void;
}
export function ActivityPanel({ receipts, port, setSelectedReceipt, sendMessage }: Props) {
  return (
    <section className="activity-panel bg-[var(--paper)] [border:1px_solid_var(--line)] rounded-[20px] p-[28px] max-[620px]:p-[24px_20px]">
      <div data-panel-enter="0" className="flex items-center justify-end">
        <Tag>
          <History size={13} />
          {receipts.length} {port.provenance === "simulated" ? "demo events" : "events"}
        </Tag>
      </div>
      {receipts.length ? (
        <div className="receipt-list mt-[25px]">
          {receipts.map((r, index) => (
            <button
              type="button"
              className="receipt-row flex items-center gap-[15px] p-[18px_0] border-0 [border-bottom:1px_solid_#313334] bg-transparent w-full text-left [&>svg]:ml-auto [&>svg]:text-[#a2a4a5] [&_b]:text-[12px] [&_b]:block [&_small]:text-[9px] [&_small]:block [&_small]:mt-[7px] [&_small]:text-[#a2a4a5] [&:hover]:bg-[#1c1e1f] max-[620px]:gap-[10px] max-[620px]:[&_b]:text-[11px] max-[620px]:[&_small]:text-[8px]"
              key={r.id}
              data-panel-enter={Math.min(index + 1, 5)}
              onClick={() => setSelectedReceipt(r)}
            >
              <span className={playClasses(`receipt-icon ${r.status}`)}>
                {r.status === "confirmed" ? <CheckCheck size={21} /> : <AlertTriangle size={21} />}
              </span>
              <span>
                <b>{r.title}</b>
                <small>
                  {port.provenance === "simulated" && (
                    <>
                      <ProvenanceTag port={port} label="Simulated" /> ·{" "}
                    </>
                  )}
                  {r.at} · {r.status}
                </small>
              </span>
              <ArrowUpRight size={19} />
            </button>
          ))}
        </div>
      ) : (
        <div
          data-panel-enter="1"
          className="empty-activity flex items-center flex-col text-center p-[65px_15px_75px] gap-[17px] [&>svg]:text-[#a2a4a5] [&_h3]:font-[family-name:var(--font-display)] [&_h3]:text-[30px] [&_h3]:font-medium [&_h3]:tracking-[-1px] [&_p]:text-[#a2a4a5] [&_p]:text-[11px] [&_p]:leading-[1.8] [&_p]:max-w-[340px] [&_.button]:mt-[8px]"
        >
          <History size={38} strokeWidth={1.3} />
          <h3>A clean slate.</h3>
          <p>
            {port.provenance === "simulated"
              ? "Your demo receipts will land here after you try a repayment or set up Guardian."
              : "Your receipts will land here after you try a repayment or set up Guardian."}
          </p>
          <button
            type="button"
            className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] blue-button bg-[var(--blue)] text-[#203327]! [&:hover]:bg-[#a7c8b1]"
            onClick={() => {
              sendMessage("Should I repay or earn yield?");
            }}
          >
            Find my first move <ArrowRight size={17} />
          </button>
        </div>
      )}
      {port.provenance === "simulated" && (
        <p className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
          Demo receipts document local UI state. Real transaction hashes and explorer links only
          appear in the future live integration.
        </p>
      )}
    </section>
  );
}
