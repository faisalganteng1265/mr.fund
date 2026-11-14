"use client";
import { mood as computeMood } from "@mrfund/engine";
import type { Card } from "@mrfund/shared";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DetailTab } from "./ConsultationTabs";
import { percent } from "./display";
import type {
  Approval,
  ConsultationSource,
  OwnerAction,
  PolicyFields,
  Receipt,
  WalletOutcome,
} from "./source/types";
import { useReplySpeech } from "./speech/replySpeech";
export type Panel = "chat" | "voice" | "position" | "guardian" | "activity";
type Modal = "wallet" | "settings" | "setup" | "help" | null;
export type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: "recommendation" | "scenario";
};
const greeting: Message = {
  id: 0,
  role: "assistant",
  text: "Hey, I'm Mr.Fund. Your money has a lot going on. Let's make sense of it together.",
};

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
export function useConsultation(source: ConsultationSource) {
  const session = useSyncExternalStore(
    source.session.subscribe,
    source.session.getSnapshot,
    source.session.getSnapshot,
  );
  const position = useSyncExternalStore(
    source.position.subscribe,
    source.position.getSnapshot,
    source.position.getSnapshot,
  );
  const execution = useSyncExternalStore(
    source.execution.subscribe,
    source.execution.getSnapshot,
    source.execution.getSnapshot,
  );
  const guardianState = useSyncExternalStore(
    source.guardian.subscribe,
    source.guardian.getSnapshot,
    source.guardian.getSnapshot,
  );
  const { connected, connecting, walletBalance } = session;
  const { dataState, debt, now, snapshot: s, current, figures } = position;
  const { receipts, lastRepay, lastChange } = execution;
  const {
    guardian,
    reserve,
    guardianSpent,
    guardianDebt,
    savedFields,
    watcherOnline,
    spendable,
    remaining,
  } = guardianState;
  const turn = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<"welcome" | "consult">("welcome");
  const [panel, setPanel] = useState<Panel | null>("chat");
  const wide = useMedia("(min-width: 1280px)");
  const phone = useMedia("(max-width: 767px)") && !wide;
  const shortMobile = useMedia("(max-height:600px) and (max-width:767px)") && !wide;
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("position");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [chatRevealed, setChatRevealed] = useState(false);
  const [detailsRevealed, setDetailsRevealed] = useState(false);
  const finishEntrance = useCallback(() => setCameraReady(true), []);
  useEffect(() => {
    if (stage !== "consult" || !cameraReady) return;
    setChatRevealed(true);
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDetailsRevealed(true);
      return;
    }
    const timer = setTimeout(() => setDetailsRevealed(true), 160);
    return () => clearTimeout(timer);
  }, [stage, cameraReady]);

  const [composerFocused, setComposerFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      setKeyboardHeight(
        composerFocused && !wide && window.innerHeight - viewport.height > 120
          ? viewport.height
          : null,
      );
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, [composerFocused, wide]);

  const openPanel = useCallback(
    (requested: Panel | null) => {
      if (wide) {
        if (requested === "position" || requested === "guardian" || requested === "activity")
          setDetailTab(requested);
        if (requested === "voice") setVoiceOpen(true);
        setPanel("chat");
      } else setPanel(requested ?? "chat");
    },
    [wide],
  );
  useEffect(() => {
    if (wide && stage === "consult" && panel !== "chat") openPanel(panel);
    if (!wide) setVoiceOpen(false);
  }, [wide, stage, panel, openPanel]);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const panelClose = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!panel) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelClose.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) openPanel(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      previousFocus.current?.focus();
    };
  }, [panel, openPanel]);
  const [modal, setModal] = useState<Modal>(null);
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [wave, setWave] = useState(0);
  const [repayAmount, setRepayAmount] = useState("100");
  const [recommendation, setRecommendation] = useState<Card | undefined>();
  const [adjusting, setAdjusting] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<Approval | null>(null);
  const [signing, setSigning] = useState(false);
  const [walletOutcome, setWalletOutcome] = useState<WalletOutcome>("success");
  const [policyFields, setPolicyFields] = useState<PolicyFields>(() => ({ ...savedFields }));
  const [setupReview, setSetupReview] = useState(false);
  const [comfort, setComfort] = useState("150");
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const messageId = useRef(0);
  const speechSequence = useRef(0);
  const replySpeech = useReplySpeech(sound);
  const speechCue = replySpeech.cue;
  const speaking = replySpeech.speaking;
  const playbackMessage = useRef<number | null>(null);
  const finishText = useCallback(
    (id: number) => {
      if (playbackMessage.current !== id) return;
      replySpeech.finishText(id);
      setStreamingId(null);
    },
    [replySpeech.finishText],
  );

  useEffect(() => {
    if (panel !== "chat" && streamingId !== null) finishText(streamingId);
  }, [panel, streamingId, finishText]);
  useEffect(() => {
    return () => {
      turn.current?.abort();
      operation.current?.abort();
      for (const timer of timeouts.current) clearTimeout(timer);
      speechSequence.current++;
      playbackMessage.current = null;
    };
  }, []);
  useEffect(() => {
    if (panel !== "chat" || messages.length === 0) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: thinking || streamingId !== null ? "auto" : "smooth",
    });
  }, [messages, thinking, streamingId, panel]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const recent = receipts[0];
  const computed = computeMood(
    s,
    recent
      ? {
          status: recent.status === "rejected" ? "failed" : recent.status,
          atMs: recent.atMs,
          txHashes: [],
          ...(recent.before && recent.after && recent.after !== "No debt"
            ? {
                observed: {
                  healthBeforeBps: String(Math.round(Number(recent.before.replace("%", "")) * 100)),
                  healthAfterBps: String(Math.round(Number(recent.after.replace("%", "")) * 100)),
                },
              }
            : {}),
        }
      : undefined,
    Math.round(Number(comfort) * 100) || 15000,
    now,
  );
  const characterMood =
    thinking || dataState === "loading"
      ? "thinking"
      : dataState === "error"
        ? "concerned"
        : computed.state;
  const { card, comp, whatIf } = source.position.advice(repayAmount, recommendation);
  const unavailable = dataState !== "fresh";
  function later(fn: () => void, ms: number) {
    const timer = setTimeout(fn, ms);
    timeouts.current.push(timer);
  }
  async function refresh() {
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    try {
      await source.position.refresh(controller.signal);
      if (!controller.signal.aborted) setNotice("Simulated position refreshed.");
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : String(error));
    }
  }
  function sendMessage(text: string) {
    if (!text.trim()) return;
    const previousReply = streamingId;
    stopReply();
    setRecommendation(undefined);
    if (previousReply !== null)
      setMessages((prev) => prev.filter((message) => message.id !== previousReply));
    const controller = new AbortController();
    turn.current = controller;
    openPanel("chat");
    const question = text.trim().slice(0, 500);
    setMessages((prev) => [...prev, { id: ++messageId.current, role: "user", text: question }]);
    setInput("");
    setThinking(true);
    const speechId = ++speechSequence.current;
    const events = source.chat.send({ message: question, amount: repayAmount }, controller.signal);
    later(async () => {
      if (speechSequence.current !== speechId || controller.signal.aborted) return;
      const id = ++messageId.current;
      const indo = /kalau|harga|aku|berapa|jelas|aman|batas|apa |bayar|utang/.test(
        question.toLowerCase(),
      );
      let text = "";
      let kind: Message["kind"];
      try {
        for await (const event of events) {
          if (controller.signal.aborted || speechSequence.current !== speechId) return;
          if (event.type === "text") text += event.text;
          else if (event.type === "progress" && event.tool === "what_if_price") kind = "scenario";
          else if (
            event.type === "card" ||
            (event.type === "progress" && event.tool === "propose_card")
          ) {
            kind = "recommendation";
            if (event.type === "card") setRecommendation(event.card);
            setCardOpen(true);
            source.execution.clearRecommendation();
          } else if (event.type === "error") {
            setNotice(event.code);
            setThinking(false);
            return;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotice(error instanceof Error ? error.message : String(error));
          setThinking(false);
        }
        return;
      }
      if (controller.signal.aborted || speechSequence.current !== speechId) return;
      if (!text) {
        setThinking(false);
        return;
      }
      playbackMessage.current = id;
      setMessages((prev) => [...prev, { id, role: "assistant", text, ...(kind ? { kind } : {}) }]);
      setStreamingId(id);
      setThinking(false);
      replySpeech.play(id, text, indo ? "id-ID" : "en-US", soundRef.current, true);
    }, 2000);
  }
  function requestAction(action: Approval | string | null) {
    if (!connected) {
      setModal("wallet");
      setNotice("Connect the mock wallet, then try the action again.");
      return;
    }
    if (typeof action === "string") {
      setNotice(action);
      return;
    }
    if (!action) return;
    setWalletOutcome("success");
    setPending(action);
  }
  async function confirmPending() {
    if (!pending || signing) return;
    setSigning(true);
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    try {
      for await (const event of source.execution.execute(
        pending.id,
        walletOutcome,
        controller.signal,
      )) {
        if (controller.signal.aborted) return;
        if (event.type === "notice") setNotice(event.text);
        else if (event.type === "done" && event.applied) {
          if (pending.title === "Activate Guardian") {
            setModal(null);
            setSetupReview(false);
          } else if (cardOpen && source.execution.getSnapshot().lastRepay !== lastRepay)
            setCardOpen(false);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) {
        setSigning(false);
        setPending(null);
      }
    }
  }
  function executeCard() {
    requestAction(source.execution.prepareRepay(repayAmount, recommendation));
  }
  function activate() {
    requestAction(source.guardian.prepare("activate", policyFields));
  }
  function ownerAction(action: OwnerAction) {
    requestAction(source.guardian.prepare(action, policyFields));
  }
  function replay(overLimit = false) {
    const message = source.guardian.replay(overLimit);
    if (message) setNotice(message);
  }
  function disconnect() {
    source.session.disconnect();
    setModal(null);
    setNotice("Mock wallet disconnected.");
  }
  function stopReply() {
    turn.current?.abort();
    speechSequence.current++;
    playbackMessage.current = null;
    setStreamingId(null);
    setThinking(false);
    replySpeech.cancel();
  }
  function clearConversation() {
    stopReply();
    setRecommendation(undefined);
    setMessages([greeting]);
    setCardOpen(false);
    source.execution.clearRecommendation();
  }
  function reset() {
    stopReply();
    setRecommendation(undefined);
    operation.current?.abort();
    source.reset();
    setMessages([greeting]);
    setCardOpen(false);
    setModal(null);
    setNotice("Demo reset. A fresh start for your money.");
  }
  function enterConsultation() {
    setStage("consult");
    openPanel("chat");
  }
  function startConsultation() {
    if (connected) enterConsultation();
    else setModal("wallet");
  }
  async function connect() {
    if (connecting) return;
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    try {
      await source.session.connect(controller.signal);
      if (controller.signal.aborted) return;
      setModal(null);
      setWave((v) => v + 1);
      setNotice("Mock wallet connected. Welcome to the office.");
      if (stage === "welcome") enterConsultation();
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : String(error));
    }
  }
  /** A real wallet finished signing in (the wallet controller owns that operation). */
  function liveConnected() {
    setModal(null);
    setWave((v) => v + 1);
    setNotice("Signed in. Welcome to the office.");
    if (stage === "welcome") enterConsultation();
  }
  const healthText =
    current.health === null || dataState === "error" || dataState === "loading"
      ? "—"
      : percent(current.health);
  return {
    source,
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
    selectDataState: source.position.selectDataState,
    debt,
    walletBalance,
    messages,
    input,
    setInput,
    thinking,
    wave,
    repayAmount,
    setRepayAmount: (value: string) => {
      setRecommendation(undefined);
      setRepayAmount(value);
    },
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
    guardianView: guardianState,
    guardian,
    reserve,
    guardianSpent,
    guardianDebt,
    policyFields,
    setPolicyFields,
    savedFields,
    setupReview,
    setSetupReview,
    comfort,
    setComfort,
    watcherOnline,
    setWatcherOnline: source.guardian.setWatcherOnline,
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
    cancelSpeech: replySpeech.cancel,
    finishText,
    current,
    figures,
    characterMood,
    card,
    comp,
    whatIf,
    unavailable,
    spendable,
    remaining,
    refresh,
    sendMessage,
    confirmPending,
    executeCard,
    policyError: source.guardian.validate(policyFields),
    activate,
    ownerAction,
    replay,
    clearConversation,
    reset,
    startConsultation,
    liveConnected,
    connect,
    healthText,
  };
}
