import { Shield } from "lucide-react";
import { ModalFrame } from "./ModalFrame";
export function HelpDialog({ close }: { close: () => void }) {
  return (
    <ModalFrame eyebrow="A LITTLE CONTEXT" title="Real idea. Demo office." close={() => close()}>
      <div className="help-block flex gap-[14px] mt-[26px] [&_b]:text-[12px] [&_p]:text-[10px] [&_p]:text-[#a2a4a5] [&_p]:leading-[1.8] [&_p]:mt-[7px]">
        <span className="help-number w-[28px] h-[28px] bg-[var(--lime)] text-[#101a17]! rounded-[7px] grid place-items-center text-[10px] shrink-0">
          01
        </span>
        <div>
          <b>Talk it through.</b>
          <p>
            Explore position summaries, repay-versus-yield, and price-drop scenarios. Chat responses
            are scripted; financial outputs use the existing deterministic engine on illustrative
            inputs.
          </p>
        </div>
      </div>
      <div className="help-block flex gap-[14px] mt-[26px] [&_b]:text-[12px] [&_p]:text-[10px] [&_p]:text-[#a2a4a5] [&_p]:leading-[1.8] [&_p]:mt-[7px]">
        <span className="help-number w-[28px] h-[28px] bg-[var(--lime)] text-[#101a17]! rounded-[7px] grid place-items-center text-[10px] shrink-0">
          02
        </span>
        <div>
          <b>Try a move.</b>
          <p>
            Connect the mock wallet, adjust a repayment, and approve it. You can simulate rejection,
            failure, or a partial batch before approval.
          </p>
        </div>
      </div>
      <div className="help-block flex gap-[14px] mt-[26px] [&_b]:text-[12px] [&_p]:text-[10px] [&_p]:text-[#a2a4a5] [&_p]:leading-[1.8] [&_p]:mt-[7px]">
        <span className="help-number w-[28px] h-[28px] bg-[var(--lime)] text-[#101a17]! rounded-[7px] grid place-items-center text-[10px] shrink-0">
          03
        </span>
        <div>
          <b>Set your limits.</b>
          <p>
            Activate a simulated Guardian, inspect its rules, run a labelled replay or over-limit
            test, then pause, deactivate, or withdraw.
          </p>
        </div>
      </div>
      <p className="risk-note flex gap-[9px] bg-[#1c1e1f] p-[15px] rounded-[9px] text-[9px] leading-[1.8] text-[#a2a4a5] mt-[24px]!">
        <Shield size={18} />
        The live product aims to reduce liquidation risk within your limits. It cannot prevent
        liquidation. Guardian and Rhea have smart-contract risks; hackathon code is unaudited.
      </p>
      <p className="mt-5! text-[9px] leading-relaxed text-[#a2a4a5]">
        Character:{" "}
        <a
          className="underline underline-offset-2"
          href="https://github.com/microsoft/Microsoft-Rocketbox"
          target="_blank"
          rel="noreferrer"
        >
          Business Male 01 by Microsoft Rocketbox
        </a>
        —{" "}
        <a
          className="underline underline-offset-2"
          href="https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md"
          target="_blank"
          rel="noreferrer"
        >
          MIT License
        </a>
        . Optimized for this demo with facial blendshapes and procedural body animation.
      </p>
    </ModalFrame>
  );
}
