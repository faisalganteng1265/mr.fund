"use client";

import { useEffect, useRef, useState } from "react";
import { createReplyController } from "./replyController";

export { spokenSummary, stripReplyMarkup } from "./replyController";

export function useReplySpeech(sound: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const controller = useRef(createReplyController(setSpeaking)).current;
  useEffect(() => {
    if (!sound) controller.cancel();
  }, [controller, sound]);
  useEffect(() => () => controller.cancel(), [controller]);
  return { ...controller, speaking };
}

export function useLiveReplySpeech(
  message: { id: number; text: string; lang: string } | null,
  sound: boolean,
) {
  const speech = useReplySpeech(sound);
  const seen = useRef(new Set<number>());
  useEffect(
    () => () => {
      seen.current.clear();
    },
    [],
  );
  const id = message?.id;
  const text = message?.text;
  const lang = message?.lang;
  const { play, cancel } = speech;
  useEffect(() => {
    if (id === undefined || text === undefined || lang === undefined) {
      cancel();
      return;
    }
    if (seen.current.has(id)) return;
    seen.current.add(id);
    if (!sound) return;
    play(id, text, lang, true, false);
  }, [id, text, lang, sound, play, cancel]);
  return { speaking: speech.speaking, cue: speech.cue, stop: cancel };
}

/**
 * A spoken reply stops as soon as the user starts typing, sends a message or presses Escape.
 * `busy` is true while the user's own message is being answered, not while a reply is spoken.
 */
export function useStopSpeechOnUserAction(
  speaking: boolean,
  stop: () => void,
  draft: string,
  busy: boolean,
) {
  useEffect(() => {
    if (draft.length > 0) stop();
  }, [draft, stop]);
  useEffect(() => {
    if (busy) stop();
  }, [busy, stop]);
  useEffect(() => {
    if (!speaking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaking, stop]);
}
