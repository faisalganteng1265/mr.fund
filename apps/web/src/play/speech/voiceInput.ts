export type VoiceInputState = "idle" | "starting" | "listening" | "stopping" | "error";

export interface VoiceInputSnapshot {
  readonly state: VoiceInputState;
  readonly transcript: string;
  readonly language: string;
  readonly notice: string | null;
  readonly error: string | null;
}

export interface VoiceInput {
  getSnapshot(): VoiceInputSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  toggle(): void;
  setTranscript(transcript: string): void;
  setLanguage(language: string): void;
  dispose(): void;
}

export interface VoiceInputResultEvent {
  results: {
    length: number;
    [index: number]: { 0: { transcript: string }; isFinal: boolean };
  };
}

export interface VoiceInputRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: VoiceInputResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface VoiceInputClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timer: number): void;
}

export const INITIAL_VOICE_INPUT: VoiceInputSnapshot = {
  state: "idle",
  transcript: "",
  language: "en-US",
  notice: null,
  error: null,
};

const SILENCE_MS = 60_000;
const SESSION_MS = 300_000;
const SILENCE_NOTICE = "Stopped after a minute of silence. Your words are kept.";
const CAP_NOTICE = "Stopped after five minutes. Your words are kept.";

function joinWords(...parts: string[]) {
  return parts
    .filter((part) => part.trim())
    .map((part) => part.trim())
    .join(" ");
}

function errorMessage(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission wasn't granted. Allow microphone access and try again, or type your question below.";
    case "audio-capture":
      return "No microphone is available. Check your microphone connection and try again, or type your question below.";
    case "network":
      return "Voice input lost its connection. Check your connection and try again, or type your question below.";
    default:
      return "Voice input stopped. Check your browser's microphone access and try again, or type your question below.";
  }
}

/** Owns recognition only: no send callback, browser globals or React lifecycle. */
export function createVoiceInput({
  clock,
  createRecognizer,
}: {
  clock: VoiceInputClock;
  createRecognizer: () => VoiceInputRecognizer | null;
}): VoiceInput {
  let snapshot = INITIAL_VOICE_INPUT;
  const subscribers = new Set<() => void>();
  let recognizer: VoiceInputRecognizer | null = null;
  let disposed = false;
  let wantsListening = false;
  let sessionStartedAt = 0;
  let lastResultAt = 0;
  let silenceTimer: number | undefined;
  let capTimer: number | undefined;
  let rapidRestarts = 0;
  let finalText = "";
  let observedIndices = new Set<number>();
  let finalIndices = new Set<number>();
  let editedIndices = new Set<number>();

  function update(change: Partial<VoiceInputSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const subscriber of subscribers) subscriber();
  }

  function clearTimers() {
    if (silenceTimer !== undefined) clock.clearTimeout(silenceTimer);
    if (capTimer !== undefined) clock.clearTimeout(capTimer);
    silenceTimer = undefined;
    capTimer = undefined;
  }

  function detach() {
    const current = recognizer;
    recognizer = null;
    if (current) {
      current.onstart = null;
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
    }
    return current;
  }

  function fail(error: string, notice: string | null = null) {
    wantsListening = false;
    clearTimers();
    const current = detach();
    update({ state: "error", error, notice });
    current?.abort();
  }

  function stop(notice: string | null = null) {
    if (disposed || !wantsListening) return;
    wantsListening = false;
    clearTimers();
    update({ state: "stopping", notice });
    try {
      recognizer?.stop();
    } catch {
      const current = detach();
      current?.abort();
      update({ state: "idle" });
    }
  }

  // Check wall-clock deadlines on events too, so delayed timers cannot revive a session.
  function expired() {
    if (!wantsListening) return false;
    if (clock.now() - sessionStartedAt >= SESSION_MS) {
      stop(CAP_NOTICE);
      return true;
    }
    if (clock.now() - lastResultAt >= SILENCE_MS) {
      stop(SILENCE_NOTICE);
      return true;
    }
    return false;
  }

  function armSilenceTimer() {
    if (silenceTimer !== undefined) clock.clearTimeout(silenceTimer);
    silenceTimer = clock.setTimeout(
      () => {
        silenceTimer = undefined;
        expired();
      },
      SILENCE_MS - (clock.now() - lastResultAt),
    );
  }

  function beginAttempt() {
    if (disposed || !wantsListening || expired()) return;
    let current: VoiceInputRecognizer | null;
    try {
      current = createRecognizer();
    } catch {
      fail("Couldn't start the microphone. Please try again, or type your question below.");
      return;
    }
    if (!current) {
      fail("Voice input isn't available in this browser. Type below, or try the labelled sample.");
      return;
    }
    recognizer = current;
    const attemptStartedAt = clock.now();
    let hadResult = false;
    observedIndices = new Set();
    finalIndices = new Set();
    editedIndices = new Set();
    current.lang = snapshot.language;
    current.continuous = true;
    current.interimResults = true;
    const isCurrent = () => !disposed && recognizer === current;
    current.onstart = () => {
      if (isCurrent() && wantsListening && !expired()) update({ state: "listening" });
    };
    current.onresult = (event) => {
      if (!isCurrent() || (wantsListening && expired())) return;
      if (wantsListening) {
        lastResultAt = clock.now();
        hadResult = true;
        rapidRestarts = 0;
        armSilenceTimer();
      }
      const interim: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result) continue;
        observedIndices.add(index);
        if (editedIndices.has(index)) continue;
        if (result.isFinal) {
          if (!finalIndices.has(index)) {
            finalText = joinWords(finalText, result[0].transcript);
            finalIndices.add(index);
          }
        } else {
          interim.push(result[0].transcript);
        }
      }
      const interimText = joinWords(...interim);
      update({ transcript: joinWords(finalText, interimText) });
    };
    current.onerror = ({ error }) => {
      if (!isCurrent()) return;
      // Silence is normal: end restarts under the same original deadlines and loop guard.
      // Network failures require an explicit retry; we never retry an unavailable service.
      if (error === "no-speech") return;
      fail(errorMessage(error));
    };
    current.onend = () => {
      if (!isCurrent()) return;
      // Keep the ended attempt attached while checking time: stop still addresses it.
      expired();
      detach();
      if (!wantsListening) {
        finalText = snapshot.transcript;
        update({ state: "idle" });
        return;
      }
      rapidRestarts = !hadResult && clock.now() - attemptStartedAt <= 2_000 ? rapidRestarts + 1 : 0;
      if (rapidRestarts > 3) {
        fail(errorMessage("restart-loop"), "Voice input stopped");
        return;
      }
      update({ state: "starting" });
      beginAttempt();
    };
    try {
      current.start();
    } catch {
      fail("Couldn't start the microphone. Please try again, or type your question below.");
    }
  }

  function start() {
    if (disposed || wantsListening || snapshot.state === "stopping") return;
    wantsListening = true;
    sessionStartedAt = clock.now();
    lastResultAt = sessionStartedAt;
    rapidRestarts = 0;
    finalText = snapshot.transcript;
    update({ state: "starting", error: null, notice: null });
    armSilenceTimer();
    capTimer = clock.setTimeout(() => {
      capTimer = undefined;
      expired();
    }, SESSION_MS);
    beginAttempt();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    start,
    stop: () => stop(),
    toggle() {
      if (wantsListening) stop();
      else start();
    },
    setTranscript(transcript: string) {
      if (disposed) return;
      finalText = transcript;
      // An edit overrides words already visible, including an in-progress segment.
      // Later segments still append; old cumulative results cannot undo the edit.
      editedIndices = new Set(observedIndices);
      update({ transcript });
    },
    setLanguage(language: string) {
      if (!disposed && (snapshot.state === "idle" || snapshot.state === "error")) {
        update({ language });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wantsListening = false;
      clearTimers();
      const current = detach();
      subscribers.clear();
      current?.abort();
    },
  };
}
