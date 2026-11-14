"use client";
import {
  type ActivationFields,
  activationSummary,
  type FieldError,
  type GuardianSnapshot,
  parseActivationForm,
  parseDecimal,
} from "@mrfund/guardian-client";
import { decimalString, type GuardianPolicy } from "@mrfund/shared";
import { type ReactNode, useState } from "react";
import type { GuardianConfigResult } from "../guardian/config";
import {
  type ControlKind,
  controlAvailability,
  type Heartbeat,
  historyNotice,
  inFlightNotice,
} from "../guardian/controls";
import {
  activationProgress,
  buildActivationStep,
  buildControl,
  buildPolicyEdit,
} from "../guardian/flow";
import {
  buildLoanStep,
  type GuardianHoldings,
  type LoanOutcome,
  type LoanRequest,
  loanAvailability,
  loanChanged,
  sweepableDebt,
} from "../guardian/loan";
import { useLiveGuardian } from "../guardian/useLiveGuardian";
import { button, primary } from "./guardianStyles";
import { PolicyEditor } from "./PolicyEditor";
import type { LiveAccountView } from "./source/liveSession";

const NEAR_DECIMALS = 24;
const FIELDS: [keyof ActivationFields, string, string][] = [
  ["maxPerAction", "Max per action", "token"],
  ["lifetimeCap", "Max total (optional)", "token"],
  ["reserveFloor", "Reserve floor", "token"],
  ["reserveDeposit", "Reserve deposit", "token"],
  ["trigger", "Act below health", "%"],
  ["target", "Aim for health (optional)", "%"],
  ["cooldownMinutes", "Cooldown", "minutes"],
];
const EMPTY: ActivationFields = {
  maxPerAction: "",
  lifetimeCap: "",
  reserveFloor: "",
  reserveDeposit: "",
  trigger: "120",
  target: "",
  cooldownMinutes: "5",
};
const TARGET_LABEL = {
  lending: "the lending contract",
  debt_token: "the debt token",
  collateral_token: "the collateral token",
} as const;
const CONTROL_LABEL: Record<ControlKind, string> = {
  pause: "Pause",
  resume: "Resume",
  deactivate: "Deactivate",
  withdraw: "Withdraw reserve",
};

/** Real Guardian setup, activation and controls for a live wallet session (tasks 4.1, 4.2). */
export function LiveGuardianPanel({
  account,
  config,
}: {
  account: LiveAccountView;
  config?: GuardianConfigResult;
}) {
  const live = useLiveGuardian(account, config);
  const [fields, setFields] = useState<ActivationFields>(EMPTY);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [reviewed, setReviewed] = useState<{ policy: GuardianPolicy; reserve: bigint } | null>(
    null,
  );
  const [reserveText, setReserveText] = useState("");
  const { view, store } = live;

  if (live.blocked)
    return (
      <Shell>
        <p role="status">Guardian setup is unavailable: {live.blocked}</p>
      </Shell>
    );
  const s = view.state;
  if (!store || s.status === "loading")
    return (
      <Shell>
        <p role="status">Reading your Guardian…</p>
      </Shell>
    );
  if (s.status === "unavailable")
    return (
      <Shell>
        <p role="alert">{s.reason}</p>
        <button type="button" className={button} onClick={() => void store.refresh()}>
          Try again
        </button>
      </Shell>
    );

  const token = s.token;
  const t = (v: bigint) => `${decimalString(v, token.decimals)} ${token.symbol}`;
  const nearText = (v: bigint) => `${decimalString(v, NEAR_DECIMALS)} NEAR`;
  const owner = { ownerId: account.accountId, nowMs: Date.now(), factory: s.factory };
  const progress = activationProgress(s.activation, view.submission);
  const canSign = view.signBlocked === null && !view.busy;

  const footer = (
    <>
      {view.signBlocked && <p className="text-xs text-[#a2a4a5]">{view.signBlocked}</p>}
      {view.busy && <p role="status">Waiting for your wallet…</p>}
      {view.notice && <p role="alert">{view.notice}</p>}
      <button
        type="button"
        className={button}
        disabled={view.busy}
        onClick={() => void store.refresh()}
      >
        Check again
      </button>
    </>
  );

  if (progress.kind === "unresolved")
    return (
      <Shell>
        <p role="status">
          Creation was sent. No Guardian is shown until the factory reports the result.
        </p>
        {progress.hashes.length > 0 && (
          <p className="break-all text-xs text-[#a2a4a5]">
            Transaction {progress.hashes.join(", ")}
          </p>
        )}
        {footer}
      </Shell>
    );

  const step = progress.step;
  if (step.kind === "create") {
    const review = () => {
      if (live.actionFee === null) return;
      const r = parseActivationForm(fields, {
        decimals: token.decimals,
        actionFee: live.actionFee,
      });
      setErrors(r.ok ? [] : r.errors);
      setReviewed(r.ok ? r.value : null);
      if (r.ok) setReserveText(decimalString(r.value.reserve, token.decimals));
    };
    return (
      <Shell>
        <h3 className="text-sm font-semibold">Step 1 of 3 · Choose your limits</h3>
        <p className="text-xs text-[#a2a4a5]">
          Mr.Fund reduces liquidation risk within limits you set. The contract enforces them.
        </p>
        {reviewed ? (
          <>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
              {activationSummary(reviewed, s.factory, token).map((line) => (
                <li key={line}>{line}</li>
              ))}
              <li>
                Creating the Guardian sends {nearText(s.factory.minFunding)} to{" "}
                {s.factory.factoryId}. That NEAR stays in the Guardian account and cannot be
                withdrawn.
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} onClick={() => setReviewed(null)}>
                Edit
              </button>
              <button
                type="button"
                className={primary}
                disabled={!canSign}
                onClick={() =>
                  void store.run(
                    buildActivationStep(s.activation, { ...owner, policy: reviewed.policy }),
                  )
                }
              >
                Create Guardian in wallet
              </button>
            </div>
          </>
        ) : (
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
                <label key={key} className="block text-xs">
                  {label} ({unit === "token" ? token.symbol : unit})
                  <input
                    inputMode="decimal"
                    value={fields[key]}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                    className="mt-1 block w-full rounded-xl border border-white/10 bg-[#1c1e1f] px-3 py-2"
                  />
                  {error && (
                    <span role="alert" className="mt-1 block text-[#ff956e]">
                      {error.message}
                    </span>
                  )}
                </label>
              );
            })}
            {live.actionFee === null ? (
              <p role="alert">The per-action fee is not configured.</p>
            ) : (
              <p className="text-xs text-[#a2a4a5]">
                Each action costs {t(live.actionFee)}. Activation fee {t(s.factory.activationFee)}{" "}
                to {s.factory.feeRecipientId}.
              </p>
            )}
            <button type="submit" className={primary}>
              Review
            </button>
          </form>
        )}
        {footer}
      </Shell>
    );
  }

  if (step.kind === "wait_creation")
    return (
      <Shell>
        <p role="status">A Guardian creation is in flight. No Guardian is shown until it lands.</p>
        {footer}
      </Shell>
    );

  if (step.kind === "claim_refund")
    return (
      <Shell>
        <p role="alert">
          Guardian creation failed. {nearText(step.amount)} is waiting for you to claim.
        </p>
        <button
          type="button"
          className={primary}
          disabled={!canSign}
          onClick={() => void store.run(buildActivationStep(s.activation, owner))}
        >
          Claim refund in wallet
        </button>
        {footer}
      </Shell>
    );

  if (step.kind === "register")
    return (
      <Shell>
        <h3 className="text-sm font-semibold">Step 2 of 3 · Register your Guardian</h3>
        <p className="text-xs">
          Your Guardian exists and is not active yet. Next: register it with{" "}
          {TARGET_LABEL[step.target]}. The storage deposit is paid from the Guardian's own NEAR.
        </p>
        <button
          type="button"
          className={primary}
          disabled={!canSign || s.storageDeposit === null}
          onClick={() =>
            void store.run(
              buildActivationStep(s.activation, {
                ...owner,
                ...(s.storageDeposit === null ? {} : { storageDeposit: s.storageDeposit }),
              }),
            )
          }
        >
          Register in wallet
        </button>
        {s.storageDeposit === null && <p role="alert">The storage minimum could not be read.</p>}
        {footer}
      </Shell>
    );

  if (step.kind === "activate") {
    const reserve = parseDecimal(reserveText, token.decimals);
    return (
      <Shell>
        <h3 className="text-sm font-semibold">Step 3 of 3 · Fund the reserve</h3>
        <label className="block text-xs">
          Reserve ({token.symbol})
          <input
            inputMode="decimal"
            value={reserveText}
            onChange={(e) => setReserveText(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-white/10 bg-[#1c1e1f] px-3 py-2"
          />
        </label>
        {reserve !== null && reserve > 0n && (
          <p className="text-xs">
            You send {t(reserve + s.factory.activationFee)}: {t(reserve)} to the reserve and a
            one-time activation fee of {t(s.factory.activationFee)} to {s.factory.feeRecipientId}.
          </p>
        )}
        <button
          type="button"
          className={primary}
          disabled={!canSign || reserve === null || reserve <= 0n}
          onClick={() =>
            reserve !== null &&
            void store.run(buildActivationStep(s.activation, { ...owner, reserve }))
          }
        >
          Activate in wallet
        </button>
        {footer}
      </Shell>
    );
  }

  if (s.activation.kind !== "activated") return null;
  const guardian = s.activation.guardian;
  const holdings = s.holdings;
  return (
    <GuardianStatus
      g={guardian}
      heartbeat={s.heartbeat}
      t={t}
      canSign={canSign}
      onControl={(kind) =>
        void store.run(
          buildControl(guardian, kind, { ownerId: account.accountId, nowMs: Date.now() }),
        )
      }
      limits={
        <PolicyEditor
          g={guardian}
          token={token}
          canSign={canSign}
          onSave={(next) =>
            store.run(
              buildPolicyEdit(guardian, next, { ownerId: account.accountId, nowMs: Date.now() }),
            )
          }
        />
      }
      loan={
        <LoanSection
          g={guardian}
          h={holdings}
          debt={token}
          outcome={view.loan}
          canSign={canSign}
          onStep={(request) =>
            holdings &&
            void store.run(
              buildLoanStep(guardian, holdings, request, {
                ownerId: account.accountId,
                nowMs: Date.now(),
              }),
            )
          }
        />
      }
      footer={footer}
    />
  );
}

function GuardianStatus({
  g,
  heartbeat: hb,
  t,
  canSign,
  onControl,
  limits,
  loan,
  footer,
}: {
  g: GuardianSnapshot;
  heartbeat: Heartbeat;
  t: (v: bigint) => string;
  canSign: boolean;
  onControl: (kind: ControlKind) => void;
  limits: ReactNode;
  loan: ReactNode;
  footer: ReactNode;
}) {
  const controls = controlAvailability(g, Date.now());
  const lock = inFlightNotice(g);
  return (
    <Shell>
      <p className="text-sm font-semibold">
        Guardian {g.status.status} · {g.guardianId}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <dt>Reserve</dt>
        <dd>{t(g.reserve.reserve)}</dd>
        <dt>Spendable</dt>
        <dd>{t(g.reserve.spendable)}</dd>
        <dt>Per action</dt>
        <dd>{t(g.policy.maxPerAction)}</dd>
        <dt>Total left</dt>
        <dd>{t(g.reserve.lifetimeRemaining)}</dd>
        <dt>Acts below</dt>
        <dd>{decimalString(BigInt(g.policy.triggerHfBps), 2)}%</dd>
        <dt>Watcher</dt>
        <dd>
          {hb.kind === "unavailable"
            ? "Heartbeat unavailable"
            : `${hb.kind === "online" ? "Seen" : "Offline, last seen"} ${Math.round(hb.ageMs / 1000)} s ago`}
        </dd>
      </dl>
      {g.status.status === "deactivated" && (
        <p className="text-xs">
          Automation is off. Past actions stand, and you can still withdraw the reserve. The
          Guardian's NEAR cannot be withdrawn.
        </p>
      )}
      {lock && <p role="alert">{lock}</p>}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CONTROL_LABEL) as ControlKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={button}
            disabled={!canSign || !controls[kind].available}
            title={controls[kind].reason ?? undefined}
            onClick={() => onControl(kind)}
          >
            {CONTROL_LABEL[kind]}
          </button>
        ))}
      </div>
      {controls.withdraw.reason && (
        <p className="text-xs text-[#a2a4a5]">Withdraw: {controls.withdraw.reason}</p>
      )}
      {limits}
      {loan}
      <h3 className="text-xs uppercase text-[#898b8c]">History</h3>
      <p className="text-xs text-[#a2a4a5]">{historyNotice(g)}</p>
      <ul className="space-y-1 text-xs">
        {g.history.attempts.map((a) => (
          <li key={a.opId.toString()}>
            #{a.opId.toString()} {a.outcome}
            {a.reason ? ` (${a.reason})` : ""} · requested {t(a.requested)} · used {t(a.used)}
          </li>
        ))}
      </ul>
      {footer}
    </Shell>
  );
}

const LOAN_LABEL: Record<LoanOutcome["intent"], string> = {
  collateral: "Collateral deposit",
  borrow: "Borrow",
  sweep: "Sweep",
};

/** Guardian-held loan: deposit collateral, borrow and sweep (task 5.5). Values are chain reads. */
function LoanSection({
  g,
  h,
  debt,
  outcome,
  canSign,
  onStep,
}: {
  g: GuardianSnapshot;
  h: GuardianHoldings | null;
  debt: { symbol: string; decimals: number };
  outcome: LoanOutcome | null;
  canSign: boolean;
  onStep: (request: LoanRequest) => void;
}) {
  const [collateralText, setCollateralText] = useState("");
  const [borrowText, setBorrowText] = useState("");
  if (!h)
    return (
      <section aria-label="Guardian loan" className="space-y-2 text-xs">
        <h3 className="uppercase text-[#898b8c]">Loan</h3>
        <p role="alert">The Guardian's loan could not be read. Check again.</p>
      </section>
    );
  const c = h.collateralToken;
  const ct = (v: bigint) => `${decimalString(v, c.decimals)} ${c.symbol}`;
  const dt = (v: bigint) => `${decimalString(v, debt.decimals)} ${debt.symbol}`;
  const steps = loanAvailability(g, h, Date.now());
  const collateral = parseDecimal(collateralText, c.decimals);
  const borrow = parseDecimal(borrowText, debt.decimals);
  const sweepDebt = sweepableDebt(g, h);
  const input =
    "mt-1 block w-full rounded-xl border border-white/10 bg-[#1c1e1f] px-3 py-2 text-sm";
  return (
    <section aria-label="Guardian loan" className="space-y-3 text-xs">
      <h3 className="uppercase text-[#898b8c]">Loan</h3>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Collateral in Rhea</dt>
        <dd>{ct(h.collateralAtomic)}</dd>
        <dt>Debt in Rhea</dt>
        <dd>{dt(h.debtAtomic)}</dd>
        <dt>Above the reserve</dt>
        <dd>{dt(sweepDebt)}</dd>
        <dt>Your wallet</dt>
        <dd>{ct(h.ownerCollateral)}</dd>
      </dl>

      <label className="block">
        Deposit collateral ({c.symbol})
        <input
          inputMode="decimal"
          value={collateralText}
          onChange={(e) => setCollateralText(e.target.value)}
          className={input}
        />
      </label>
      {collateral !== null && collateral > 0n && (
        <p>
          You send {ct(collateral)} from your wallet to {g.guardianId}, which adds it to its Rhea
          collateral. The contract returns any amount Rhea does not take.
        </p>
      )}
      <button
        type="button"
        className={primary}
        disabled={
          !canSign || !steps.collateral.available || collateral === null || collateral <= 0n
        }
        onClick={() => collateral !== null && onStep({ kind: "collateral", amount: collateral })}
      >
        Deposit in wallet
      </button>
      {steps.collateral.reason && <p className="text-[#a2a4a5]">{steps.collateral.reason}</p>}

      <label className="block">
        Borrow ({debt.symbol})
        <input
          inputMode="decimal"
          value={borrowText}
          onChange={(e) => setBorrowText(e.target.value)}
          className={input}
        />
      </label>
      {borrow !== null && borrow > 0n && (
        <p>
          Your Guardian borrows {dt(borrow)} from {g.config.lendingId}; the tokens arrive at the
          Guardian, outside the reserve. Borrowing lowers the health factor, and Rhea refuses a
          borrow that leaves the position unhealthy or lacks fresh prices.
        </p>
      )}
      <button
        type="button"
        className={primary}
        disabled={!canSign || !steps.borrow.available || borrow === null || borrow <= 0n}
        onClick={() => borrow !== null && onStep({ kind: "borrow", amount: borrow })}
      >
        Borrow in wallet
      </button>
      {steps.borrow.reason && <p className="text-[#a2a4a5]">{steps.borrow.reason}</p>}

      <p>
        Sweep sends tokens the Guardian holds to your wallet. For {debt.symbol} only the amount
        above the reserve moves; the contract computes it when the call runs.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={!canSign || !steps.sweep_debt.available}
          title={steps.sweep_debt.reason ?? undefined}
          onClick={() => onStep({ kind: "sweep", token: "debt_token" })}
        >
          Sweep {dt(sweepDebt)}
        </button>
        <button
          type="button"
          className={button}
          disabled={!canSign || !steps.sweep_collateral.available}
          title={steps.sweep_collateral.reason ?? undefined}
          onClick={() => onStep({ kind: "sweep", token: "collateral_token" })}
        >
          Sweep {ct(h.heldCollateral)}
        </button>
      </div>
      {outcome && <LoanResult o={outcome} ct={ct} dt={dt} />}
    </section>
  );
}

function LoanResult({
  o,
  ct,
  dt,
}: {
  o: LoanOutcome;
  ct: (v: bigint) => string;
  dt: (v: bigint) => string;
}) {
  const changed = loanChanged(o);
  const label = LOAN_LABEL[o.intent];
  if (!o.after || changed === null)
    return <p role="alert">{label}: the result could not be read. Check again.</p>;
  const a = o.after;
  const b = o.before;
  const at = new Date(a.readAtMs).toISOString();
  if (!changed)
    return (
      <p role="status">
        {o.walletError
          ? `${label}: your wallet did not confirm, and nothing changed on chain as of ${at}.`
          : `${label}: sent, but no change is visible on chain as of ${at}. The contract may still be processing it, or it returned the amount. Check again.`}
      </p>
    );
  const line =
    o.intent === "collateral"
      ? `Collateral in Rhea ${ct(b.collateralAtomic)} → ${ct(a.collateralAtomic)}`
      : o.intent === "borrow"
        ? `Debt in Rhea ${dt(b.debtAtomic)} → ${dt(a.debtAtomic)}`
        : `Held by the Guardian ${dt(b.heldDebt)} → ${dt(a.heldDebt)}, ${ct(b.heldCollateral)} → ${ct(a.heldCollateral)}`;
  return (
    <div role="status" className="space-y-1">
      <p>
        {label} observed on chain at {at}: {line}.
      </p>
      {o.hashes.length > 0 && (
        <p className="break-all text-[#a2a4a5]">Transaction {o.hashes.join(", ")}</p>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-[24px] border border-white/8 bg-[#1f2122] p-5 text-[#edf3f5]">
      <span className="rounded-full bg-[#292d2b] px-2.5 py-1 text-[10px] text-[#aeb8b1]">
        Guardian · live
      </span>
      {children}
    </section>
  );
}
