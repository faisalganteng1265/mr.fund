"use client";
import {
  ArrowUpRight,
  BarChart3,
  History,
  Info,
  MessageCircle,
  Mic,
  ShieldCheck,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import { useLiveOpening } from "../execution/useLiveOpening";
import { useLiveRepay } from "../execution/useLiveRepay";
import type { WalletSession } from "../wallet/react";
import { ActivityPanel } from "./ActivityPanel";
import { ApprovalDialog } from "./ApprovalDialog";
import { ChatPanel } from "./ChatPanel";
import { ConsultationHeader } from "./ConsultationHeader";
import { ConsultationTabs, type DetailTab } from "./ConsultationTabs";
import { DetailContent } from "./DetailContent";
import { amount } from "./display";
import { GuardianPanel } from "./GuardianPanel";
import { GuardianSetupDialog } from "./GuardianSetupDialog";
import { HelpDialog } from "./HelpDialog";
import { ImmersiveSceneFrame } from "./ImmersiveSceneFrame";
import { LiveGuardianPanel } from "./LiveGuardianPanel";
import { LiveChatPanel, LivePositionPanel } from "./LivePanels";
import { liveHeaderStats } from "./live/headerStats";
import { ModalFrame } from "./ModalFrame";
import { PositionPanel } from "./PositionPanel";
import { ReceiptDetail } from "./ReceiptDetail";
import { SettingsDialog } from "./SettingsDialog";
import { createDemoSource } from "./source/demoSource";
import type { ConsultationSource } from "./source/types";
import { useLiveReplySpeech, useStopSpeechOnUserAction } from "./speech/replySpeech";
import { panelReveal } from "./styles";
import { type Panel, useConsultation } from "./useConsultation";
import { useLiveConsultation } from "./useLiveConsultation";
import { VoicePanel } from "./VoicePanel";
import { WalletDialog } from "./WalletDialog";

/** Without a wallet provider (tests, isolated renders) real login is simply unavailable. */
const OFFLINE_WALLET: WalletSession = {
  controller: null,
  network: null,
  available: [],
  configError: null,
  state: { status: "disconnected", session: null, error: null },
  busy: false,
  login: async () => {},
  logout: async () => {},
  selectAccount: () => {},
};

const CharacterPortrait = dynamic(
  () => import("./CharacterPortrait").then((m) => m.CharacterPortrait),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 bg-transparent">
        <span className="absolute bottom-[36%] left-0 w-full animate-pulse text-center text-[11px] font-semibold text-[#dcdfe6]">
          Opening the office…
        </span>
      </div>
    ),
  },
);
export function Playground({
  source,
  wallet,
}: {
  source?: ConsultationSource;
  wallet?: WalletSession;
} = {}) {
  const [defaultSource] = useState(() => source ?? createDemoSource());
  const activeSource = source ?? defaultSource;
  const liveAccount = wallet?.state.status === "connected" ? wallet.state.session : undefined;
  const liveView = liveAccount
    ? { ...liveAccount, accounts: liveAccount.accounts.map((account) => account.accountId) }
    : undefined;
  const live = useLiveConsultation(liveView);
  const repay = useLiveRepay(liveView, process.env.NEXT_PUBLIC_NEAR_RPC_URL);
  const opening = useLiveOpening(liveView, process.env.NEXT_PUBLIC_NEAR_RPC_URL);
  const {
    stage,
    panel,
    speaking,
    streamingId,
    detailTab,
    setDetailTab,
    voiceOpen,
    setVoiceOpen,
    chatRevealed,
    detailsRevealed,
    setComposerFocused,
    keyboardHeight,
    setKeyboardHeight,
    sound,
    setSound,
    connected,
    disconnect,
    connecting,
    modal,
    setModal,
    dataState,
    selectDataState,
    debt,
    walletBalance,
    messages,
    input,
    setInput,
    thinking,
    wave,
    repayAmount,
    setRepayAmount,
    adjusting,
    setAdjusting,
    cardOpen,
    setCardOpen,
    lastRepay,
    lastChange,
    receipts,
    selectedReceipt,
    setSelectedReceipt,
    pending,
    setPending,
    signing,
    walletOutcome,
    setWalletOutcome,
    guardianView,
    policyFields,
    setPolicyFields,
    setupReview,
    setSetupReview,
    comfort,
    setComfort,
    watcherOnline,
    setWatcherOnline,
    notice,
    setNotice,
    wide,
    phone,
    shortMobile,
    finishEntrance,
    openPanel,
    panelClose,
    scrollRef,
    speechCue,
    cancelSpeech,
    finishText,
    current,
    figures,
    characterMood,
    card,
    comp,
    whatIf,
    unavailable,
    refresh,
    sendMessage,
    confirmPending,
    executeCard,
    policyError,
    activate,
    ownerAction,
    replay,
    clearConversation,
    reset,
    startConsultation,
    liveConnected,
    connect,
    healthText,
  } = useConsultation(activeSource);
  const latestLiveMessage = live.messages.at(-1);
  const liveSpeech = useLiveReplySpeech(
    liveAccount && latestLiveMessage?.role === "assistant"
      ? {
          id: latestLiveMessage.id,
          text: latestLiveMessage.content,
          lang:
            typeof navigator !== "undefined" && navigator.language
              ? navigator.language
              : /kalau|harga|aku|berapa|jelas|aman|batas|apa |bayar|utang/i.test(
                    latestLiveMessage.content,
                  )
                ? "id-ID"
                : "en-US",
        }
      : null,
    sound,
  );
  const speakingNow = liveAccount ? liveSpeech.speaking : speaking;
  const stopSpeaking = liveAccount ? liveSpeech.stop : cancelSpeech;
  useStopSpeechOnUserAction(
    speakingNow,
    stopSpeaking,
    liveAccount ? live.input : input,
    liveAccount ? live.busy : false,
  );
  function guardianContent() {
    return (
      <GuardianPanel
        view={guardianView}
        port={activeSource.guardian}
        ownerAction={ownerAction}
        replay={replay}
        setup={() => {
          setSetupReview(false);
          setModal("setup");
        }}
      />
    );
  }

  function activityContent() {
    return (
      <ActivityPanel
        receipts={receipts}
        port={activeSource.execution}
        setSelectedReceipt={setSelectedReceipt}
        sendMessage={sendMessage}
      />
    );
  }

  function positionContent() {
    if (liveAccount) return <LivePositionPanel live={live} />;
    return (
      <PositionPanel
        port={activeSource.position}
        figures={figures}
        state={dataState}
        health={healthText}
        debt={amount(debt)}
        liquidation={current.liquidation ? `$${Number(current.liquidation).toFixed(2)}` : "—"}
        comfort={comfort}
        noDebt={current.health === "no_debt"}
        change={lastChange}
        onRefresh={refresh}
        onSettings={() => setModal("settings")}
        onExplain={() => sendMessage("Explain my position")}
      />
    );
  }

  function toolContent(value: DetailTab) {
    if (value === "position") return positionContent();
    if (liveAccount && value === "guardian")
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <LiveGuardianPanel
            account={{
              ...liveAccount,
              accounts: liveAccount.accounts.map((account) => account.accountId),
            }}
          />
        </div>
      );
    if (liveAccount)
      return <p className="p-5 text-sm text-[#a2a4a5]">No live activity is available yet.</p>;
    if (value === "guardian")
      return (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {guardianContent()}
          <button
            type="button"
            onClick={() => sendMessage("What are my Guardian limits?")}
            data-panel-enter="5"
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-[#313334] bg-[#1c1e1f] px-4 py-3 text-xs font-semibold"
          >
            Ask about my limits
            <ArrowUpRight size={16} />
          </button>
        </div>
      );
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4 [&_.activity-panel]:border-0! [&_.activity-panel]:p-0! [&_.panel-heading]:flex-col [&_.panel-heading]:items-start [&_.panel-heading_h2]:text-[25px]!">
        {activityContent()}
      </div>
    );
  }

  const panelTitles: Record<Panel, string> = {
    chat: "Let's talk money.",
    voice: "I'm all ears.",
    position: "Here's where you stand.",
    guardian: "Meet your Guardian.",
    activity: "Every move, accounted for.",
  };
  const dockItems: { id: Panel; label: string; icon: ReactNode; color: string }[] = [
    {
      id: "chat",
      label: "Chat",
      icon: <MessageCircle size={25} strokeWidth={1.8} />,
      color: "bg-[#bad7c3] text-[#203327]",
    },
    {
      id: "position",
      label: "Position",
      icon: <BarChart3 size={25} strokeWidth={1.8} />,
      color: "bg-[#1c1e1f] text-[#edf3f5]",
    },
    {
      id: "voice",
      label: "Voice",
      icon: <Mic size={29} strokeWidth={1.8} />,
      color: "bg-[#ff643b] text-[#171b23]!",
    },
    {
      id: "guardian",
      label: "Guardian",
      icon: <ShieldCheck size={25} strokeWidth={1.8} />,
      color: "bg-[#dbf884] text-[#101a17]!",
    },
    {
      id: "activity",
      label: "Activity",
      icon: <History size={25} strokeWidth={1.8} />,
      color: "bg-[#1c1e1f] text-[#a2a4a5]",
    },
  ];
  return (
    <main
      style={keyboardHeight ? { height: keyboardHeight } : undefined}
      className="play-app fixed inset-0 isolate flex h-dvh w-full flex-col overflow-hidden [color-scheme:dark] [--dock-icon:44px] [--voice-icon:50px] [--dock-item:52px] sm:[--dock-icon:48px] sm:[--voice-icon:54px] sm:[--dock-item:60px] [--ink:#eeeeF3] [--cream:#202223] [--paper:#121415] [--orange:#ff956e] [--blue:#bad7c3] [--lime:#d7f8a4] [--line:#313334] bg-[#0c0e0f] font-[family-name:var(--font-body)] text-sm text-[#eeeef3] antialiased [&_*]:box-border [&_button]:cursor-pointer [&_button]:[font-family:inherit] [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-45 [&_input]:[font-family:inherit] [&_select]:[font-family:inherit] [&_a]:text-inherit [&_a]:no-underline [&_:where(h1,h2,h3,p)]:m-0 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#c7d7ca] [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-[#c7d7ca] [&_svg]:shrink-0 selection:bg-[#e4d7ba] selection:text-[#151718] motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none!"
    >
      {phone && stage === "consult" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[#121415] bg-[url(/play/chat-texture.svg)] bg-repeat"
        />
      )}
      <h1 className="sr-only">Mr.Fund — your personal DeFi companion</h1>
      <div className="absolute inset-0 flex flex-col">
        {stage === "consult" && (
          <ConsultationHeader
            stage={stage}
            chatRevealed={chatRevealed}
            phone={phone}
            keyboardHeight={keyboardHeight}
            shortMobile={shortMobile}
            healthText={liveAccount ? "—" : healthText}
            dataState={liveAccount ? "loading" : dataState}
            debt={liveAccount ? 0n : debt}
            port={liveAccount ? activeSource.session : activeSource.position}
            liveAccount={liveAccount?.accountId}
            liveStats={liveAccount ? liveHeaderStats(live.state) : undefined}
            sound={sound}
            setSound={setSound}
            setNotice={setNotice}
            connected={connected}
            setModal={setModal}
            speaking={speakingNow}
            onStopSpeaking={stopSpeaking}
          />
        )}
        <div
          className={`mx-auto grid min-h-0 w-full max-w-[1920px] flex-1 ${phone ? "grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0 px-0 pb-[96px]" : `gap-4 px-4 md:gap-5 md:px-8 ${keyboardHeight || shortMobile ? `grid-cols-1 grid-rows-[minmax(0,1fr)] ${keyboardHeight ? "pb-4" : "pb-[88px]"}` : "grid-rows-[164px_minmax(0,1fr)] pb-[100px] md:grid-cols-[.7fr_1.3fr] md:grid-rows-1 xl:grid-cols-[.8fr_1.45fr_1fr] xl:pb-6"}`}`}
        >
          <section
            aria-label="Your companion"
            hidden={
              chatRevealed &&
              (keyboardHeight !== null ||
                (!phone && shortMobile) ||
                (phone && panel !== "chat" && panel !== null))
            }
            className={
              phone ? "absolute inset-0" : "relative col-start-1 row-start-1 min-h-0 min-w-0"
            }
          >
            <ImmersiveSceneFrame
              immersive={!chatRevealed || phone}
              transparent={phone && stage === "consult"}
            >
              <CharacterPortrait
                mood={liveAccount ? (live.busy ? "thinking" : "calm") : characterMood}
                speaking={liveAccount ? liveSpeech.speaking : speaking}
                mobile={phone}
                speech={liveAccount ? liveSpeech.cue : speechCue}
                wave={wave}
                station={stage === "welcome" ? "office" : "chat"}
                onEntranceComplete={finishEntrance}
              />
            </ImmersiveSceneFrame>
          </section>
          {stage === "welcome" && (
            <section
              aria-labelledby="welcome-title"
              className="fixed inset-x-0 bottom-[max(32px,env(safe-area-inset-bottom))] z-30 flex justify-center px-6"
            >
              <h2 id="welcome-title" className="sr-only">
                Start your consultation with Mr.Fund
              </h2>
              <button
                type="button"
                onClick={startConsultation}
                className="flex min-h-14 min-w-[260px] items-center justify-center gap-5 rounded-full border border-[#e0eee45c] bg-[#d3e5d7] px-7 text-sm font-semibold text-[#203327] transition-colors hover:bg-[#e1efe4]"
              >
                Start consultation <ArrowUpRight size={19} />
              </button>
            </section>
          )}

          {wide && (
            <aside
              aria-label="Consultation details"
              inert={!detailsRevealed}
              aria-hidden={!detailsRevealed}
              className={`relative z-10 col-start-3 row-start-1 hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#121415] xl:flex ${detailTab === "position" ? "bg-[url(/play/chat-texture.svg)] bg-repeat" : ""} ${panelReveal(detailsRevealed)}`}
            >
              <div className="shrink-0 px-4 pt-4">
                <ConsultationTabs
                  value={detailTab}
                  onChange={setDetailTab}
                  activityCount={liveAccount ? 0 : receipts.length}
                />
              </div>
              <div
                id="consultation-detail-panel"
                role="tabpanel"
                aria-labelledby={`detail-tab-${detailTab}`}
                className="flex min-h-0 flex-1 flex-col"
              >
                <DetailContent key={`${detailTab}-${detailsRevealed}`}>
                  {toolContent(detailTab)}
                </DetailContent>
              </div>
            </aside>
          )}
          {panel && (
            <aside
              role={panel === "chat" ? "region" : "dialog"}
              aria-labelledby="office-panel-title"
              inert={!chatRevealed}
              aria-hidden={!chatRevealed}
              className={`relative z-10 col-start-1 ${phone || keyboardHeight || shortMobile ? "row-start-1" : "row-start-2"} flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[#121415] md:col-start-2 md:row-start-1 [&_.chat-panel]:flex-1 ${phone ? `rounded-none! border-0! ${panel === "chat" ? "bg-transparent!" : ""}` : ""} ${panel === "position" ? "bg-[url(/play/chat-texture.svg)] bg-repeat" : ""} ${panelReveal(chatRevealed)}`}
            >
              <h2 id="office-panel-title" className="sr-only">
                {panelTitles[panel]}
              </h2>
              {!wide && panel !== "chat" && (
                <div className="flex shrink-0 justify-end px-4 pt-3">
                  <button
                    type="button"
                    ref={panelClose}
                    aria-label="Close overlay"
                    onClick={() => openPanel(null)}
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-[#313334] bg-[#1c1e1f]"
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
              {panel === "chat" && liveAccount && (
                <LiveChatPanel
                  live={live}
                  repay={repay}
                  opening={opening}
                  phone={phone}
                  setComposerFocused={setComposerFocused}
                  setKeyboardHeight={setKeyboardHeight}
                  openPanel={openPanel}
                />
              )}
              {panel === "chat" && !liveAccount && (
                <ChatPanel
                  phone={phone}
                  scrollRef={scrollRef}
                  thinking={thinking}
                  messages={messages}
                  streamingId={streamingId}
                  whatIf={whatIf}
                  finishText={finishText}
                  sendMessage={sendMessage}
                  port={activeSource.position}
                  cardOpen={cardOpen}
                  card={card}
                  comp={comp}
                  repayAmount={repayAmount}
                  adjusting={adjusting}
                  unavailable={unavailable}
                  setRepayAmount={setRepayAmount}
                  setAdjusting={setAdjusting}
                  setCardOpen={setCardOpen}
                  executeCard={executeCard}
                  refresh={refresh}
                  lastRepay={lastRepay}
                  setSelectedReceipt={setSelectedReceipt}
                  input={input}
                  setInput={setInput}
                  setComposerFocused={setComposerFocused}
                  setKeyboardHeight={setKeyboardHeight}
                  clearConversation={clearConversation}
                  openPanel={openPanel}
                />
              )}
              {panel === "voice" && (
                <VoicePanel
                  busy={liveAccount ? live.busy : thinking || streamingId !== null}
                  live={Boolean(liveAccount)}
                  onSend={
                    liveAccount
                      ? (question) => {
                          void live.send(question);
                        }
                      : sendMessage
                  }
                  onNotice={setNotice}
                />
              )}
              {panel !== "chat" && panel !== "voice" && (
                <DetailContent key={`${panel}-${chatRevealed}`}>{toolContent(panel)}</DetailContent>
              )}
            </aside>
          )}
        </div>
        {stage === "consult" && chatRevealed && !wide && (phone || keyboardHeight === null) && (
          <nav
            aria-label="Office actions"
            className="absolute inset-x-0 bottom-[max(8px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-max max-w-[calc(100%_-_16px)] items-end gap-2 px-2 pb-2 pt-3 sm:gap-5 sm:px-6 sm:pb-3 [@media(max-height:600px)]:gap-1! [@media(max-height:600px)]:py-2"
          >
            {dockItems.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={item.label}
                aria-pressed={panel === item.id}
                onClick={() => openPanel(panel === item.id ? null : item.id)}
                className={`group flex w-[var(--dock-item)] flex-col items-center gap-2 [@media(max-height:600px)]:gap-1 border-0 bg-transparent p-0 transition-transform duration-200 hover:-translate-y-1 ${item.id === "voice" ? "-mt-5 [@media(max-height:600px)]:-mt-2" : ""}`}
              >
                <span
                  className={`relative grid size-[var(--dock-icon)] place-items-center rounded-[19px] border border-white/8 shadow-none transition-transform group-active:translate-y-1 group-active:shadow-none ${item.color} ${item.id === "voice" ? "size-[var(--voice-icon)]! rounded-[23px]!" : ""} ${panel === item.id ? "outline-2 outline-offset-4 outline-[#ff643b]" : ""}`}
                >
                  {item.icon}
                  {!liveAccount && item.id === "activity" && receipts.length > 0 && (
                    <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-[#313334] bg-[#ff643b] text-[#171b23]! text-[8px] font-bold">
                      {receipts.length}
                    </span>
                  )}
                </span>
                <span className="text-[8px] font-bold tracking-[.04em] text-[#a2a4a5] sm:text-[10px]">
                  {item.label}
                </span>
              </button>
            ))}
          </nav>
        )}
      </div>

      {wide && voiceOpen && (
        <ModalFrame
          title="Speak with Mr.Fund."
          eyebrow="VOICE CONSULTATION"
          close={() => setVoiceOpen(false)}
        >
          <VoicePanel
            busy={liveAccount ? live.busy : thinking || streamingId !== null}
            live={Boolean(liveAccount)}
            onSend={(question) => {
              setVoiceOpen(false);
              if (liveAccount) void live.send(question);
              else sendMessage(question);
            }}
            onNotice={setNotice}
          />
        </ModalFrame>
      )}
      <div className="relative z-40">
        {notice && (
          <div
            className="play-toast fixed right-[max(16px,env(safe-area-inset-right))] top-[max(16px,env(safe-area-inset-top))] z-[100] grid w-[380px] max-w-[calc(100vw_-_32px)] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-[20px] border border-white/10 bg-[#1c1e1f] p-4 text-[#edf3f5] transition-[opacity,translate] duration-200 ease-out starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none"
            role="status"
            aria-atomic="true"
          >
            <span className="mt-0.5 grid size-9 place-items-center rounded-[12px] bg-[#bad7c314] text-[#bad7c3]">
              <Info size={18} strokeWidth={1.7} />
            </span>
            <div className="min-w-0 py-0.5">
              <p className="font-[family-name:var(--font-display)] text-[13px] font-semibold tracking-[-.2px]">
                Mr.Fund
              </p>
              <p className="mt-1.5! text-[13px] leading-[1.6] text-[#b8bdbc] [overflow-wrap:anywhere]">
                {notice}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
              className="-mr-1 -mt-1 grid size-9 place-items-center rounded-full border-0 bg-transparent text-[#818a85] transition-colors hover:bg-[#2b2f2d] hover:text-[#edf3f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#bad7c3]"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>
        )}

        {modal === "wallet" && (
          <WalletDialog
            connected={connected}
            connecting={connecting}
            walletBalance={walletBalance}
            stage={stage}
            port={activeSource.session}
            close={() => setModal(null)}
            connect={connect}
            disconnect={disconnect}
            setNotice={setNotice}
            wallet={wallet ?? OFFLINE_WALLET}
            liveConnected={liveConnected}
          />
        )}
        {!liveAccount && modal === "settings" && (
          <SettingsDialog
            dataState={dataState}
            selectDataState={selectDataState}
            comfort={comfort}
            setComfort={setComfort}
            watcherOnline={watcherOnline}
            setWatcherOnline={setWatcherOnline}
            reset={reset}
            close={() => setModal(null)}
          />
        )}
        {!liveAccount && modal === "help" && <HelpDialog close={() => setModal(null)} />}
        {!liveAccount && modal === "setup" && (
          <GuardianSetupDialog
            port={activeSource.guardian}
            policyFields={policyFields}
            setPolicyFields={setPolicyFields}
            setupReview={setupReview}
            setSetupReview={setSetupReview}
            policyError={policyError}
            activate={activate}
            close={() => setModal(null)}
          />
        )}
        {!liveAccount && pending && (
          <ApprovalDialog
            pending={pending}
            signing={signing}
            walletOutcome={walletOutcome}
            setWalletOutcome={setWalletOutcome}
            close={() => setPending(null)}
            setNotice={setNotice}
            confirmPending={confirmPending}
          />
        )}
        {!liveAccount && selectedReceipt && (
          <ReceiptDetail
            receipt={selectedReceipt}
            port={activeSource.execution}
            close={() => setSelectedReceipt(null)}
            openActivity={() => {
              setSelectedReceipt(null);
              openPanel("activity");
            }}
          />
        )}
      </div>
    </main>
  );
}
