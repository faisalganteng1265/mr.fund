import { Check, LoaderCircle } from "lucide-react";
import { ModalFrame } from "./ModalFrame";
import type { Approval, WalletOutcome } from "./source/types";

interface Props {
  pending: Approval;
  signing: boolean;
  walletOutcome: WalletOutcome;
  setWalletOutcome: (outcome: WalletOutcome) => void;
  close: () => void;
  setNotice: (text: string) => void;
  confirmPending: () => void;
}
export function ApprovalDialog({
  pending,
  signing,
  walletOutcome,
  setWalletOutcome,
  close,
  setNotice,
  confirmPending,
}: Props) {
  return (
    <ModalFrame
      eyebrow="MOCK WALLET · NO REAL SIGNATURE"
      title={signing ? "Making your move…" : pending.title}
      close={() => {
        if (!signing) close();
      }}
    >
      <p className="modal-copy text-[12px] leading-[1.8] text-[#a2a4a5] m-[20px_0]! max-[620px]:text-[11px]">
        {pending.description}
      </p>
      <div className="approval-amount flex flex-col gap-[11px] items-center bg-[#1c1e1f] p-[27px_15px] rounded-[11px] text-center [&_small]:text-[8px] [&_small]:tracking-[.1em] [&_small]:text-[#a2a4a5] [&_b]:font-[family-name:var(--font-display)] [&_b]:text-[25px] [&_b]:tracking-[-.7px] [&_span]:text-[9px] [&_span]:text-[#a2a4a5] max-[620px]:[&_b]:text-[23px]">
        <small>YOU AUTHORIZE IN THIS DEMO</small>
        <b>{pending.amount}</b>
        <span>Account: you.demo.testnet</span>
      </div>
      <label className="form-field flex flex-col gap-[8px] mt-[21px] min-w-0 [&>span]:text-[10px] [&>span]:font-bold [&>span]:flex [&>span]:justify-between [&>span_small]:text-[8px] [&>span_small]:font-normal [&>span_small]:text-[#a2a4a5] [&_input]:p-[12px] [&_input]:bg-[#1c1e1f] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[7px] [&_input]:text-[12px] [&_input]:text-[var(--ink)] [&_input]:w-full [&_input]:min-w-0 [&_select]:p-[12px] [&_select]:bg-[#1c1e1f] [&_select]:[border:1px_solid_#313334] [&_select]:rounded-[7px] [&_select]:text-[12px] [&_select]:text-[var(--ink)] [&_select]:w-full [&_select]:min-w-0 [&>small]:text-[8px] [&>small]:leading-[1.5] [&>small]:text-[#a2a4a5] max-[620px]:[&>span]:text-[9px] max-[620px]:[&_input]:text-[11px] max-[620px]:[&_input]:p-[11px_9px] max-[620px]:[&_select]:text-[11px] max-[620px]:[&_select]:p-[11px_9px] max-[620px]:[&>small]:text-[7px]">
        <span>Demo transaction outcome</span>
        <select
          disabled={signing}
          value={walletOutcome}
          onChange={(e) => setWalletOutcome(e.target.value as WalletOutcome)}
        >
          <option value="success">Confirmed — apply demo action</option>
          <option value="cancel">Wallet rejection — keep draft</option>
          <option value="failure">Transaction failure — keep balances</option>
          <option value="partial">Partial batch — review receipt</option>
        </select>
      </label>
      <div className="modal-actions flex gap-[10px] justify-end mt-[25px] [&_.button]:flex-1 [&_.button]:text-[10px]! max-[620px]:gap-[8px] max-[620px]:[&_.button]:text-[9px]! max-[620px]:[&_.button]:p-[12px_9px] max-[620px]:[&_.button]:gap-[6px]">
        <button
          type="button"
          className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40]"
          disabled={signing}
          onClick={() => {
            close();
            setNotice("You cancelled. Your draft is still here.");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] blue-button bg-[var(--blue)] text-[#203327]! [&:hover]:bg-[#a7c8b1]"
          disabled={signing}
          onClick={confirmPending}
        >
          {signing ? <LoaderCircle className="spin animate-spin" size={17} /> : <Check size={17} />}
          {signing ? "Simulating…" : "Approve demo action"}
        </button>
      </div>
    </ModalFrame>
  );
}
