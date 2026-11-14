import { CircleHelp, Settings2, Square, Volume2, VolumeX, Wallet } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { amount } from "./display";
import type { LiveHeaderStats } from "./live/headerStats";
import { ProvenanceTag, Tag } from "./ProvenanceTag";
import type { DataState, Port } from "./source/types";

interface Props {
  stage: "welcome" | "consult";
  chatRevealed: boolean;
  phone: boolean;
  keyboardHeight: number | null;
  shortMobile: boolean;
  healthText: string;
  dataState: DataState;
  debt: bigint;
  port: Port;
  sound: boolean;
  setSound: Dispatch<SetStateAction<boolean>>;
  setNotice: (text: string) => void;
  connected: boolean;
  setModal: (modal: "settings" | "help" | "wallet") => void;
  liveAccount?: string | undefined;
  /** Figures from the live position; when set, the demo figures above are not shown. */
  liveStats?: LiveHeaderStats | undefined;
  /** True while a reply is being spoken; the Stop button shows only then. */
  speaking?: boolean | undefined;
  onStopSpeaking?: (() => void) | undefined;
}
export function ConsultationHeader({
  stage,
  chatRevealed,
  phone,
  keyboardHeight,
  shortMobile,
  healthText,
  dataState,
  debt,
  port,
  sound,
  setSound,
  setNotice,
  connected,
  setModal,
  liveAccount,
  liveStats,
  speaking,
  onStopSpeaking,
}: Props) {
  return (
    <header
      inert={!chatRevealed}
      aria-hidden={!chatRevealed}
      className={`relative z-20 mx-auto flex h-[76px] w-full max-w-[1920px] shrink-0 items-center justify-between gap-3 px-4 md:h-[88px] md:px-8 transition-opacity duration-500 ${chatRevealed ? "opacity-100" : "opacity-0"} ${phone || keyboardHeight || shortMobile ? "h-14!" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-[#e4d7ba] font-[family-name:var(--font-display)] text-2xl font-bold tracking-[-2px] text-[#1f2122]">
          m.
        </span>
        <span className="font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-[-1px]">
          mr.fund<span className="ml-1 align-top text-[9px] text-[#999b9c] max-sm:hidden">®</span>
        </span>
        {stage === "consult" && !liveAccount && (
          <Tag className="text-[#a2a4a5]">
            <ProvenanceTag port={port} label="SIMULATED" />
          </Tag>
        )}
        <span className="ml-3 hidden border-l border-white/10 pl-4 text-[10px] text-[#818384] 2xl:block">
          A little clarity for your money.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {stage === "consult" && (!liveAccount || liveStats) && (
          <section
            aria-label="Position stats"
            className={`mr-3 hidden grid-cols-2 items-center gap-x-5 gap-y-1 text-sm lg:grid ${liveStats ? "" : "2xl:grid-cols-[auto_auto_auto]"}`}
          >
            <span className="text-[#8f9192]">
              Health{" "}
              <b className="ml-2 text-base font-semibold text-[#d7f8a4] tabular-nums">
                {liveStats?.health ?? healthText}
              </b>
            </span>
            <span className="text-[#8f9192]">
              Debt{" "}
              <b className="ml-2 text-base font-semibold text-[#e4dfed] tabular-nums">
                {liveStats
                  ? liveStats.debt
                  : dataState === "fresh" && debt > 0n
                    ? `$${amount(debt)}`
                    : "—"}
              </b>
            </span>
            {!liveStats && (
              <ProvenanceTag
                port={port}
                label="SIMULATED · PnL unavailable"
                className="col-span-2 text-xs text-[#a2a4a5] 2xl:col-span-1"
              />
            )}
          </section>
        )}
        {speaking && onStopSpeaking && (
          <button
            type="button"
            aria-label="Stop speaking"
            onClick={onStopSpeaking}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[#313334] bg-[#1c1e1f] px-3 text-xs text-[#edf3f5] hover:bg-[#25292b]"
          >
            <Square size={12} fill="currentColor" aria-hidden="true" />
            <span className="max-sm:hidden">Stop</span>
          </button>
        )}
        {!liveAccount && (
          <button
            type="button"
            aria-label="Demo settings"
            onClick={() => setModal("settings")}
            className="grid size-9 place-items-center rounded-full border-0 bg-transparent text-[#989a9b] hover:bg-[#25292b]"
          >
            <Settings2 size={17} />
          </button>
        )}
        {!liveAccount && (
          <button
            type="button"
            aria-label={sound ? "Mute spoken replies" : "Enable spoken replies"}
            aria-pressed={sound}
            onClick={() => {
              if (!("speechSynthesis" in window)) {
                setNotice(
                  "Spoken replies aren't supported by this browser. Text chat still works.",
                );
                return;
              }
              setSound((value) => !value);
              window.speechSynthesis.cancel();
            }}
            className="grid size-9 place-items-center rounded-full border-0 bg-transparent text-[#989a9b] hover:bg-[#25292b]"
          >
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        )}
        {!liveAccount && (
          <button
            type="button"
            aria-label="How it works"
            onClick={() => setModal("help")}
            className="hidden size-9 place-items-center rounded-full border-0 bg-transparent text-[#989a9b] hover:bg-[#25292b] sm:grid"
          >
            <CircleHelp size={17} />
          </button>
        )}
        {stage === "consult" && (
          <button
            type="button"
            aria-label={liveAccount ? `Wallet: ${liveAccount}` : undefined}
            onClick={() => setModal("wallet")}
            className="ml-1 flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-[#202223] px-3 text-[11px] font-medium text-[#d8d5e0]"
          >
            <Wallet size={15} />
            <span className="hidden sm:block">
              {liveAccount ?? (connected ? "you.demo.testnet" : "Connect wallet")}
            </span>
            <span className="sr-only sm:hidden">
              {liveAccount ?? (connected ? "you.demo.testnet" : "Connect wallet")}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
