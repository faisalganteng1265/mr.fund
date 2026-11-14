import type {
  VoiceInputClock,
  VoiceInputRecognizer,
  VoiceInputResultEvent,
} from "../src/play/speech/voiceInput";

export class VoiceInputFakeClock implements VoiceInputClock {
  private time = 0;
  private sequence = 0;
  private timers = new Map<number, { at: number; run: () => void }>();
  now = () => this.time;
  setTimeout = (run: () => void, delay: number) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delay, run });
    return id;
  };
  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };
  advance(ms: number) {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].run();
    }
    this.time = target;
  }
  get pending() {
    return this.timers.size;
  }
}

export class VoiceInputFakeRecognizer implements VoiceInputRecognizer {
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: VoiceInputResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  startError = false;
  stopError = false;
  start() {
    this.starts++;
    if (this.startError) throw new Error("Recognizer could not start");
  }
  stop() {
    this.stops++;
    if (this.stopError) throw new Error("Recognizer could not stop");
  }
  abort() {
    this.aborts++;
  }
  ready() {
    this.onstart?.();
  }
  result(...segments: [text: string, final: boolean][]) {
    this.onresult?.({
      results: segments.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })),
    });
  }
  end() {
    this.onend?.();
  }
  error(error: string) {
    this.onerror?.({ error });
  }
}

export function voiceInputRecognizerFactory() {
  const recognizers: VoiceInputFakeRecognizer[] = [];
  return {
    recognizers,
    createRecognizer: () => {
      const recognizer = new VoiceInputFakeRecognizer();
      recognizers.push(recognizer);
      return recognizer;
    },
    latest() {
      const recognizer = recognizers.at(-1);
      if (!recognizer) throw new Error("No recognizer was started");
      return recognizer;
    },
  };
}
