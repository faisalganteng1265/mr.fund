"use client";
import type { ChatEvent, ConversationMessage } from "@mrfund/agent";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LiveChatError, streamLiveChat } from "./source/liveChat";
import { buildLiveChatRequest } from "./source/liveChatRequest";
import { createLivePosition } from "./source/livePosition";
import type { LiveAccountView } from "./source/liveSession";

type Card = Extract<ChatEvent, { type: "card" }>["card"];
const EMPTY = { status: "loading" } as const;
const noSubscribe = () => () => {};

export function useLiveConsultation(account?: LiveAccountView) {
  const accountId = account?.accountId;
  const network = account?.network;
  const position = useMemo(
    () => (accountId && network ? createLivePosition(accountId, network) : null),
    [accountId, network],
  );
  const state = useSyncExternalStore(
    position?.subscribe ?? noSubscribe,
    position?.getSnapshot ?? (() => EMPTY),
    () => EMPTY,
  );
  const [messages, setMessages] = useState<(ConversationMessage & { id: number })[]>([]);
  const messageId = useRef(0);
  const [input, setInput] = useState("");
  const [partial, setPartial] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<number | undefined>(undefined);
  const [progress, setProgress] = useState("");
  const [identity, setIdentity] = useState("");
  const currentIdentity = accountId && network ? `${network}:${accountId}` : "";
  const current = identity === currentIdentity;
  const turn = useRef<AbortController | null>(null);
  const resetSlow = useCallback(() => {
    window.clearTimeout(slowTimer.current);
    slowTimer.current = undefined;
    setSlow(false);
  }, []);
  function cancel() {
    turn.current?.abort();
    turn.current = null;
    resetSlow();
    setBusy(false);
    setPartial("");
  }
  useEffect(() => {
    const controller = new AbortController();
    turn.current?.abort();
    resetSlow();
    setIdentity(currentIdentity);
    setMessages([]);
    setInput("");
    setPartial("");
    setCard(null);
    setError("");
    setBusy(false);
    void position?.refresh(controller.signal).catch(() => {});
    return () => {
      controller.abort();
      turn.current?.abort();
      window.clearTimeout(slowTimer.current);
      position?.dispose();
    };
  }, [position, currentIdentity, resetSlow]);
  useEffect(() => {
    if (state.status !== "network_mismatch") return;
    turn.current?.abort();
    resetSlow();
    setBusy(false);
    setPartial("");
    setCard(null);
  }, [state.status, resetSlow]);
  async function send(text: string) {
    if (
      !account ||
      !current ||
      !text.trim() ||
      text.length > 4000 ||
      state.status === "loading" ||
      state.status === "network_mismatch"
    )
      return;
    turn.current?.abort();
    resetSlow();
    const controller = new AbortController();
    turn.current = controller;
    const request = buildLiveChatRequest({
      message: text,
      accountId: account.accountId,
      history: messages.map(({ role, content }) => ({ role, content })),
      locale: navigator.language.slice(0, 2),
    });
    const questionId = ++messageId.current;
    setMessages((old) => [...old, { id: questionId, role: "user", content: text }]);
    setInput("");
    setPartial("");
    setCard(null);
    setError("");
    setBusy(true);
    slowTimer.current = window.setTimeout(() => {
      if (!controller.signal.aborted && turn.current === controller) setSlow(true);
    }, 15_000);
    setProgress("Connecting…");
    let answer = "";
    let nextCard: Card | null = null;
    try {
      for await (const event of streamLiveChat(request, controller.signal)) {
        if (controller.signal.aborted) return;
        if (event.type === "progress")
          setProgress(
            event.stage === "reading"
              ? "Reading your position…"
              : event.stage === "checking"
                ? "Checking the reply…"
                : "Checking the numbers…",
          );
        if (event.type === "text") {
          answer += event.text;
          setPartial(answer);
        }
        if (event.type === "card") nextCard = event.card;
        if (event.type === "error")
          throw new LiveChatError(event.code === "timeout" ? "timeout" : "unavailable");
      }
      if (controller.signal.aborted) return;
      const answerId = ++messageId.current;
      setMessages((old) => [...old, { id: answerId, role: "assistant", content: answer }]);
      setPartial("");
      setCard(nextCard);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setPartial("");
      setInput(text);
      setMessages((old) => old.slice(0, -1));
      setError(
        caught instanceof LiveChatError && caught.code === "timeout"
          ? "The reply timed out. Please try again."
          : caught instanceof LiveChatError && caught.code === "rate_limited"
            ? "Too many requests. Please wait before trying again."
            : caught instanceof LiveChatError && caught.code === "invalid_request"
              ? "I could not read that question. Please edit it and try again."
              : caught instanceof LiveChatError &&
                  (caught.code === "interrupted" || caught.code === "invalid_stream")
                ? "The reply was interrupted. Please try again."
                : "The assistant is unavailable. Please try again.",
      );
    } finally {
      if (turn.current === controller) {
        resetSlow();
        setBusy(false);
      }
    }
  }
  function clear() {
    cancel();
    setMessages([]);
    setPartial("");
    setCard(null);
    setError("");
  }
  return {
    state,
    messages: current ? messages : [],
    input: current ? input : "",
    setInput,
    partial: current ? partial : "",
    card: current ? card : null,
    error: current ? error : "",
    busy: current ? busy : false,
    slow: current && busy && slow,
    progress,
    send,
    clear,
    cancel,
    refresh: () => {
      void position?.refresh();
    },
  };
}
