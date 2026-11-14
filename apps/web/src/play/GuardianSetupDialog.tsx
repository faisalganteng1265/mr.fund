import { AlertTriangle, ArrowRight, LockKeyhole, Shield } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ModalFrame } from "./ModalFrame";
import { PolicyField } from "./PolicyField";
import { ProvenanceTag, Tag } from "./ProvenanceTag";
import type { PolicyFields, Port } from "./source/types";
import { playClasses } from "./styles";

interface Props {
  port: Port;
  policyFields: PolicyFields;
  setPolicyFields: Dispatch<SetStateAction<PolicyFields>>;
  setupReview: boolean;
  setSetupReview: (review: boolean) => void;
  policyError: string | null;
  activate: () => void;
  close: () => void;
}
export function GuardianSetupDialog({
  port,
  policyFields,
  setPolicyFields,
  setupReview,
  setSetupReview,
  policyError,
  activate,
  close,
}: Props) {
  const field = (
    name: keyof PolicyFields,
    label: string,
    suffix: string,
    hint: string,
    optional = false,
  ) => (
    <PolicyField
      name={name}
      label={label}
      suffix={suffix}
      hint={hint}
      optional={optional}
      policyFields={policyFields}
      setPolicyFields={setPolicyFields}
      setSetupReview={setSetupReview}
    />
  );

  return (
    <ModalFrame
      eyebrow={setupReview ? "YOUR RULES, IN PLAIN WORDS" : "LET'S SET SOME BOUNDARIES"}
      title={setupReview ? "Your Guardian. Your terms." : "A Guardian on your terms."}
      close={() => {
        close();
        setSetupReview(false);
      }}
      wide
    >
      <div className="setup-steps flex items-center gap-[10px] mt-[24px] [&>span]:text-[9px] [&>span]:text-[#a2a4a5] [&>span]:font-semibold [&>span.current]:text-[var(--blue)] [&>i]:flex-1 [&>i]:h-[1px] [&>i]:bg-[#1c1e1f] max-[620px]:[&>span]:text-[8px]">
        <span className={playClasses(!setupReview ? "current" : "")}>01 Configure</span>
        <i />
        <span className={playClasses(setupReview ? "current" : "")}>02 Review</span>
        <i />
        <span>{port.provenance === "simulated" ? "03 Mock approval" : "03 Approval"}</span>
      </div>
      <div className="setup-position flex items-center gap-[11px] bg-[#1c1e1f] p-[15px] [border:1px_solid_#313334] rounded-[9px] mt-[23px] [&>span]:flex-1 [&>span]:min-w-0 [&_b]:block [&_b]:text-[11px] [&_small]:block [&_small]:text-[8px] [&_small]:leading-[1.6] [&_small]:mt-[5px] [&_small]:text-[#a2a4a5] [&_.tag]:text-[7px] [&_.tag]:text-[#a2a4a5] [&_.tag]:[border-color:#d6dfc7] max-[620px]:p-[12px] max-[620px]:gap-[8px] max-[620px]:[&_b]:text-[9px] max-[620px]:[&_small]:text-[7px] max-[620px]:[&_.tag]:hidden">
        <Shield size={20} />
        <span>
          <b>Guardian-held loan · NEAR / USDC</b>
          <small>
            <ProvenanceTag
              port={port}
              label="Separate simulated position. Your wallet loan stays where it is."
            />
          </small>
        </span>
        {port.provenance === "simulated" && <Tag>G1 DEMO</Tag>}
      </div>
      {!setupReview ? (
        <>
          <div className="fixed-action mt-[23px] [&_small]:text-[8px] [&_small]:tracking-[.08em] [&_small]:text-[#a2a4a5] [&_b]:flex [&_b]:items-center [&_b]:justify-between [&_b]:text-[11px] [&_b]:mt-[9px] [&_b]:pb-[15px] [&_b]:[border-bottom:1px_solid_var(--line)]">
            <small>ALLOWED ACTION</small>
            <b>
              Repay USDC debt from my reserve <LockKeyhole size={14} />
            </b>
          </div>
          <div className="setup-form-grid grid grid-cols-[1fr_1fr] gap-x-[20px] max-[620px]:gap-x-[12px]">
            {field("max", "Maximum per action", "USDC", "Largest single repayment.")}
            {field("cap", "Lifetime spending cap", "USDC", "At least your per-action maximum.")}
            {field("floor", "Reserve to keep", "USDC", "Automation never spends below this.")}
            {field("deposit", "Reserve deposit", "USDC", "Activation fee is added on top.")}
            {field(
              "trigger",
              "Trigger below health",
              "%",
              "Minimum 105%; liquidation line is 100%.",
            )}
            {field(
              "target",
              "Target health after action",
              "%",
              "Must be above your trigger.",
              true,
            )}
            {field("cooldown", "Time between actions", "min", "Minimum 5 minutes.")}
          </div>
          {policyError && (
            <p
              className="field-error flex items-start gap-[6px] text-[#ffb18c] text-[10px] leading-[1.7] mt-[18px]!"
              role="alert"
            >
              <AlertTriangle size={15} />
              {policyError}
            </p>
          )}
        </>
      ) : (
        <div className="policy-summary pt-[20px] [&_p]:text-[13px] [&_p]:leading-[1.9] [&_p]:text-[#a2a4a5] [&_p]:mt-[13px] [&_b]:text-[var(--ink)] [&_b]:font-bold max-[620px]:[&_p]:text-[12px]">
          <p>
            {port.provenance === "simulated"
              ? "When the simulated Guardian loan's health falls below"
              : "When the Guardian loan's health falls below"}{" "}
            <b>{policyFields.trigger}%</b>, it may repay up to <b>{policyFields.max} USDC</b> per
            action, with at least <b>{policyFields.cooldown} minutes</b> between actions.
          </p>
          <p>
            It will keep at least <b>{policyFields.floor} USDC</b> in reserve and spend no more than{" "}
            <b>{policyFields.cap} USDC</b> over this activation.{" "}
            {policyFields.target && (
              <>
                The sizing target is <b>{policyFields.target}%</b> health.
              </>
            )}
          </p>
          <p>
            You deposit <b>{policyFields.deposit} USDC</b> into the{" "}
            {port.provenance === "simulated" ? "demo reserve" : "reserve"}. Pause or deactivate
            whenever you want, and withdraw unused reserve.
          </p>
        </div>
      )}
      {port.provenance === "simulated" && (
        <>
          <div className="fee-box bg-[#1c1e1f] rounded-[9px] p-[15px] mt-[23px] flex flex-col gap-[11px] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:text-[10px] [&>div]:gap-[8px] [&>div>span]:flex [&>div>span]:items-center [&>div>span]:gap-[8px] [&_.tag]:text-[6px] [&_.tag]:text-[#a2a4a5] [&_.tag]:p-[3px_4px] [&_b]:text-[10px] [&_b]:whitespace-nowrap [&>small]:text-[8px] [&>small]:text-[#a2a4a5] [&>small]:leading-[1.7] max-[620px]:p-[12px] max-[620px]:[&_.tag]:text-[5px] max-[620px]:[&_.tag]:tracking-[0] max-[620px]:[&>div]:text-[8px] max-[620px]:[&_b]:text-[8px] max-[620px]:[&>small]:text-[7px]">
            <div>
              <span>
                Activation fee <Tag>EXAMPLE PRICING</Tag>
              </span>
              <b>1.00 test USDC</b>
            </div>
            <div>
              <span>Per-action fee</span>
              <b>0.00 test USDC</b>
            </div>
            <small>
              Recipient: fees.demo.testnet · Demo pricing only; live pricing is undecided.
            </small>
          </div>
          <p className="fine-print text-[9px] leading-[1.8] text-[#a2a4a5] mt-[18px]! block [&>svg]:[vertical-align:middle] [&>svg]:mr-[5px]">
            This flow simulates a separate Guardian account and loan. No account is created and no
            tokens move on-chain. Protection cannot prevent liquidation.
          </p>
        </>
      )}
      <div className="modal-actions flex gap-[10px] justify-end mt-[25px] [&_.button]:flex-1 [&_.button]:text-[10px]! max-[620px]:gap-[8px] max-[620px]:[&_.button]:text-[9px]! max-[620px]:[&_.button]:p-[12px_9px] max-[620px]:[&_.button]:gap-[6px]">
        <button
          type="button"
          className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] outline-button [border:1px_solid_#313334] bg-transparent [&:hover]:bg-[#ffffff40]"
          onClick={setupReview ? () => setSetupReview(false) : () => close()}
        >
          {setupReview ? "Back to edit" : "Maybe later"}
        </button>
        <button
          type="button"
          className="button border-0 inline-flex items-center justify-center gap-[12px] p-[13px_17px] min-h-[43px] rounded-[9px] text-[11px]! font-bold! [transition:transform_.17s,background_.17s,box-shadow_.17s] [&:hover:not(:disabled)]:transform-[translateY(-2px)] [&:hover:not(:disabled)]:shadow-none [&:active:not(:disabled)]:transform-[translateY(0)] [&.small]:p-[10px_13px] [&.small]:min-h-[35px] [&.small]:text-[10px]! [&.small]:gap-[8px] [&.small]:rounded-[7px] blue-button bg-[var(--blue)] text-[#203327]! [&:hover]:bg-[#a7c8b1]"
          disabled={!!policyError}
          onClick={setupReview ? activate : () => setSetupReview(true)}
        >
          {setupReview
            ? port.provenance === "simulated"
              ? "Approve in mock wallet"
              : "Approve in wallet"
            : "Review my rules"}
          <ArrowRight size={17} />
        </button>
      </div>
    </ModalFrame>
  );
}
