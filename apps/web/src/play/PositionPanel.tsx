import {
  AlertTriangle,
  ArrowUpRight,
  MessageCircle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Image from "next/image";
import { ProvenanceTag } from "./ProvenanceTag";
import type { DataState, Port, PositionView } from "./source/types";

type Props = {
  state: DataState;
  port: Port;
  figures: PositionView["figures"];
  health: string;
  debt: string;
  liquidation: string;
  comfort: string;
  noDebt: boolean;
  /** Set after a simulated repay; strings come from the engine-backed demo state. */
  change: { repaid: string; before: string; after: string } | null;
  onRefresh: () => void;
  onSettings: () => void;
  onExplain: () => void;
};

/** Render only values and recovery intents supplied by the position view. */
export function PositionPanel(props: Props) {
  const empty = props.state === "empty";
  const error = props.state === "error";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5">
        {empty || error ? (
          <section
            data-panel-enter="0"
            className="rounded-[22px] border border-white/6 bg-[#1c1e1f] p-5"
          >
            <AlertTriangle size={20} className="mb-4 text-[#ffbd94]" />
            <h3 className="font-[family-name:var(--font-display)] text-2xl leading-tight">
              {error ? "Can't reach NEAR right now." : "A little room for your next move."}
            </h3>
            <p className="mt-3! text-xs leading-relaxed text-[#989a9b]">
              {error
                ? "A simulated RPC error. Try refreshing."
                : "No position in this demo state. Open one on Rhea in the live app."}
            </p>
            <button
              type="button"
              onClick={error ? props.onRefresh : props.onSettings}
              className="mt-5 rounded-full border border-white/10 bg-[#2c2e2f] px-4 py-2.5 text-xs text-[#cdcfd0]"
            >
              {error ? "Retry" : "Switch demo state"}
            </button>
          </section>
        ) : props.state === "loading" ? (
          <div data-panel-enter="0" role="status" className="space-y-4">
            <div className="h-40 animate-pulse rounded-[22px] bg-[#25292b]" />
            <div className="h-40 animate-pulse rounded-[22px] bg-[#25292b]" />
            <span className="sr-only">Loading simulated position</span>
          </div>
        ) : (
          <>
            <section
              data-panel-enter="0"
              className="rounded-[24px] border border-[#e4d7ba1a] bg-[#1f2122] p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#b2b4b5]">Position health</span>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-semibold tracking-[.12em] text-[#898b8c]">
                    RHEA / NEAR
                  </span>
                  <button
                    type="button"
                    aria-label="Refresh simulated position"
                    onClick={props.onRefresh}
                    className="grid size-8 place-items-center rounded-full border border-white/8 bg-[#25292b] text-[#a8aaab] hover:bg-[#25292b]"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>
              <strong className="mt-3 block font-[family-name:var(--font-display)] text-[clamp(38px,3vw,54px)] font-medium leading-none tracking-[-2px] text-[#dadcdd] tabular-nums">
                {props.health}
              </strong>
              <div className="mt-5 flex items-start gap-2 text-[10px] leading-relaxed text-[#a4a6a7]">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-[#d7f8a4]" />
                <span>
                  {props.state === "stale"
                    ? "Data is 5 minutes old. Refresh before acting."
                    : props.noDebt
                      ? "No debt remaining."
                      : `Your comfort line is ${props.comfort}%. Liquidation is possible below 100%.`}
                </span>
              </div>
              {props.change && (
                <p className="mt-3! rounded-full bg-[#12301f] px-3 py-1.5 text-[10px] font-semibold text-[#3fe08a]">
                  After your last simulated repay: {props.change.before} → {props.change.after}
                </p>
              )}
            </section>
            <h3
              data-panel-enter="1"
              className="mb-3! mt-6! text-[10px] font-medium uppercase tracking-[.15em] text-[#757778]"
            >
              Your position
            </h3>
            <ul data-panel-enter="2" className="m-0 flex list-none flex-col gap-3 p-0">
              {[
                {
                  logo: "/play/tokens/near.svg",
                  name: "NEAR",
                  description: "Collateral",
                  delta: null,
                  amount: `$${props.figures.collateralUsd}`,
                  icon: "bg-[#f1f2f0] p-[9px]",
                  line: "#3fe08a",
                  points: "0,20 10,18 18,21 28,14 36,16 46,9 56,13 66,7 78,11 90,4 100,6",
                  pill: "border-white/10 bg-[#2b2f31] text-[#3fe08a]",
                  trend: <TrendingUp size={14} />,
                },
                {
                  logo: "/play/tokens/usdc.svg",
                  name: "USDC",
                  description: "Debt",
                  delta: props.change ? `−$${props.change.repaid}` : null,
                  amount: `$${props.debt}`,
                  icon: "bg-[#0b53bf]",
                  line: "#f0b36a",
                  points: "0,8 10,10 18,7 28,12 36,10 46,15 56,12 66,17 78,14 90,19 100,16",
                  pill: "border-white/10 bg-[#2b2f31] text-[#f0b36a]",
                  trend: <TrendingDown size={14} />,
                },
              ].map((asset) => (
                <li
                  key={asset.name}
                  className={`flex min-h-[60px] items-center gap-3 rounded-full border border-white/10 bg-[#1e2123] py-2 pl-2 pr-2 shadow-[inset_0_1px_0_#ffffff0d]`}
                >
                  <span
                    className={`grid size-11 shrink-0 place-items-center rounded-full border-2 border-white/25 font-[family-name:var(--font-display)] text-xl font-bold ${asset.icon}`}
                  >
                    <Image
                      src={asset.logo}
                      alt=""
                      width={36}
                      height={36}
                      className="block size-full object-contain"
                    />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <b className="text-base font-semibold text-[#e8ebea]">{asset.name}</b>
                    <span className="flex items-center gap-1.5 text-[10px] text-[#8c9290]">
                      {asset.description}
                      {asset.delta && (
                        <span className="rounded-full bg-[#12301f] px-1.5 py-0.5 font-semibold text-[#3fe08a]">
                          {asset.delta}
                        </span>
                      )}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 100 24"
                    preserveAspectRatio="none"
                    className="h-7 min-w-0 flex-1"
                  >
                    <polyline
                      points={asset.points}
                      fill="none"
                      stroke={asset.line}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <span
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold tabular-nums ${asset.pill}`}
                  >
                    {asset.trend}
                    <span>{asset.amount}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p
              data-panel-enter="3"
              className="mt-3! px-1 text-[10px] leading-relaxed text-[#757778]"
            >
              <ProvenanceTag
                port={props.port}
                label="Trend lines are illustrative shapes, not price history. Amounts come from the simulated position."
              />
            </p>
            <dl data-panel-enter="4" className="mt-5 space-y-3 px-1 text-[11px]">
              {[
                ["Est. NEAR liquidation price", props.liquidation],
                ["Borrow APR", props.figures.borrowApr],
                ["Supply APR", props.figures.supplyApr],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-[#898b8c]">{label}</dt>
                  <dd className="m-0 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
      <div
        data-panel-enter="5"
        className="shrink-0 bg-[#121415] bg-[url(/play/chat-texture.svg)] bg-repeat px-5 pb-5 pt-3"
      >
        <button
          type="button"
          onClick={props.onExplain}
          className="flex min-h-11 w-full items-center justify-between rounded-full border border-[#e4d7ba26] bg-[#202223] px-4 py-3 text-xs text-[#c5c7c8] transition-colors hover:bg-[#2d2f30]"
        >
          <span className="flex items-center gap-2">
            <MessageCircle size={14} />
            Talk me through it
          </span>
          <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}
