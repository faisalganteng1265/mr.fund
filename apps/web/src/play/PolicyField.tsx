import type { Dispatch, SetStateAction } from "react";
import type { PolicyFields } from "./source/types";

interface Props {
  name: keyof PolicyFields;
  label: string;
  suffix: string;
  hint: string;
  optional?: boolean;
  policyFields: PolicyFields;
  setPolicyFields: Dispatch<SetStateAction<PolicyFields>>;
  setSetupReview: (review: boolean) => void;
}
export function PolicyField({
  name,
  label,
  suffix,
  hint,
  optional = false,
  policyFields,
  setPolicyFields,
  setSetupReview,
}: Props) {
  return (
    <label className="form-field flex flex-col gap-[8px] mt-[21px] min-w-0 [&>span]:text-[10px] [&>span]:font-bold [&>span]:flex [&>span]:justify-between [&>span_small]:text-[8px] [&>span_small]:font-normal [&>span_small]:text-[#a2a4a5] [&_input]:p-[12px] [&_input]:bg-[#1c1e1f] [&_input]:[border:1px_solid_#313334] [&_input]:rounded-[7px] [&_input]:text-[12px] [&_input]:text-[var(--ink)] [&_input]:w-full [&_input]:min-w-0 [&_select]:p-[12px] [&_select]:bg-[#1c1e1f] [&_select]:[border:1px_solid_#313334] [&_select]:rounded-[7px] [&_select]:text-[12px] [&_select]:text-[var(--ink)] [&_select]:w-full [&_select]:min-w-0 [&>small]:text-[8px] [&>small]:leading-[1.5] [&>small]:text-[#a2a4a5] max-[620px]:[&>span]:text-[9px] max-[620px]:[&_input]:text-[11px] max-[620px]:[&_input]:p-[11px_9px] max-[620px]:[&_select]:text-[11px] max-[620px]:[&_select]:p-[11px_9px] max-[620px]:[&>small]:text-[7px]">
      <span>
        {label}
        {optional && <small>Optional</small>}
      </span>
      <div className="field-input relative [&_input]:pr-[55px] [&_b]:absolute [&_b]:right-[13px] [&_b]:top-[14px] [&_b]:text-[9px] [&_b]:text-[#a2a4a5] [&_b]:font-medium [&_b]:pointer-events-none max-[620px]:[&_b]:text-[8px] max-[620px]:[&_b]:top-[13px] max-[620px]:[&_b]:right-[9px] max-[620px]:[&_input]:pr-[44px]">
        <input
          type="number"
          min="0"
          step={
            name === "trigger" || name === "target"
              ? "0.01"
              : name === "cooldown"
                ? "1"
                : "0.000001"
          }
          value={policyFields[name]}
          onChange={(e) => {
            setPolicyFields((f) => ({ ...f, [name]: e.target.value }));
            setSetupReview(false);
          }}
        />
        <b>{suffix}</b>
      </div>
      <small>{hint}</small>
    </label>
  );
}
