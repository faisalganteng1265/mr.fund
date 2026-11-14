"use client";
import {
  type FieldError,
  type GuardianSnapshot,
  type PolicyFields,
  parsePolicyForm,
  policyChangeSummary,
  policyFields,
} from "@mrfund/guardian-client";
import { decimalString, type GuardianPolicy } from "@mrfund/shared";
import { useState } from "react";
import { policyEditAvailability } from "../guardian/controls";
import { button, primary } from "./guardianStyles";

const FIELDS: [keyof PolicyFields, string, string][] = [
  ["maxPerAction", "Max per action", "token"],
  ["lifetimeCap", "Max total", "token"],
  ["reserveFloor", "Reserve floor", "token"],
  ["trigger", "Act below health", "%"],
  ["target", "Aim for health (optional)", "%"],
  ["cooldownMinutes", "Cooldown", "minutes"],
];

/**
 * Owner-only limits editor for an activated Guardian: review the change as "old → new", then one
 * wallet-signed `set_policy`. What it shows afterwards is the chain's policy, not the wallet's
 * answer. Permission boundary: only the owner's wallet can send it, and the contract re-checks
 * the owner and the limits. Does not guarantee that the new limits make the watcher act, or that
 * a repay succeeds; the contract can still reject an action.
 */
export function PolicyEditor({
  g,
  token,
  canSign,
  onSave,
}: {
  g: GuardianSnapshot;
  token: { symbol: string; decimals: number };
  canSign: boolean;
  onSave: (policy: GuardianPolicy) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<PolicyFields>(() => policyFields(g.policy, token.decimals));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [reviewed, setReviewed] = useState<GuardianPolicy | null>(null);
  const [sent, setSent] = useState<GuardianPolicy | null>(null);
  const available = policyEditAvailability(g, Date.now());
  const spent = `${decimalString(g.reserve.spentTotal, token.decimals)} ${token.symbol}`;

  const open = () => {
    setFields(policyFields(g.policy, token.decimals));
    setErrors([]);
    setReviewed(null);
    setSent(null);
    setEditing(true);
  };
  const review = () => {
    const r = parsePolicyForm(fields, {
      decimals: token.decimals,
      actionFee: g.policy.actionFee,
      spentTotal: g.reserve.spentTotal,
    });
    setErrors(r.ok ? [] : r.errors);
    setReviewed(r.ok ? r.value : null);
  };
  const save = async (policy: GuardianPolicy) => {
    await onSave(policy);
    setSent(policy);
    setEditing(false);
    setReviewed(null);
  };
  const applied = sent !== null && policyChangeSummary(g.policy, sent, token).length === 0;

  if (!editing)
    return (
      <section aria-label="Guardian limits" className="space-y-2 text-xs">
        <button
          type="button"
          className={button}
          disabled={!available.available}
          title={available.reason ?? undefined}
          onClick={open}
        >
          Edit limits
        </button>
        {available.reason && <p className="text-[#a2a4a5]">Limits: {available.reason}</p>}
        {sent && applied && (
          <p role="status">Limits updated: the chain now shows the limits you reviewed.</p>
        )}
        {sent && !applied && (
          <p role="status">
            The chain still shows your previous limits. The change may not have been sent or may
            still be settling. Check again in a moment.
          </p>
        )}
      </section>
    );

  if (reviewed) {
    const lines = policyChangeSummary(g.policy, reviewed, token);
    return (
      <section aria-label="Guardian limits" className="space-y-3 text-xs">
        <h3 className="uppercase text-[#898b8c]">Review new limits</h3>
        {lines.length === 0 ? (
          <p>Nothing changed.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 leading-relaxed">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="text-[#a2a4a5]">
          Only you can change these limits, and they apply to the next action. Mr.Fund reduces
          liquidation risk within limits you set. It cannot prevent liquidation; the contract can
          reject an action.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setReviewed(null)}>
            Back
          </button>
          {lines.length > 0 && (
            <button
              type="button"
              className={primary}
              disabled={!canSign}
              onClick={() => void save(reviewed)}
            >
              Update limits in wallet
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Guardian limits" className="space-y-3 text-xs">
      <h3 className="uppercase text-[#898b8c]">Edit limits</h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        {FIELDS.map(([key, label, unit]) => {
          const error = errors.find((e) => e.field === key);
          return (
            <label key={key} className="block">
              {label} ({unit === "token" ? token.symbol : unit})
              <input
                inputMode="decimal"
                value={fields[key]}
                aria-invalid={error ? true : undefined}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                className="mt-1 block w-full rounded-xl border border-white/10 bg-[#1c1e1f] px-3 py-2 text-sm"
              />
              {error && (
                <span role="alert" className="mt-1 block text-[#ff956e]">
                  {error.message}
                </span>
              )}
            </label>
          );
        })}
        <p className="text-[#a2a4a5]">
          The Guardian has already spent {spent}; Max total cannot go below that. The per-action fee
          and your reserve stay as they are.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="submit" className={primary}>
            Review changes
          </button>
        </div>
      </form>
    </section>
  );
}
