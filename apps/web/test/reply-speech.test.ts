// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  spokenSummary,
  stripReplyMarkup,
  useLiveReplySpeech,
  useReplySpeech,
  useStopSpeechOnUserAction,
} from "../src/play/speech/replySpeech";

class Utterance {
  lang = "";
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
  constructor(public text: string) {}
}
const spoken: Utterance[] = [];
const cancel = vi.fn();
function setup() {
  vi.useFakeTimers();
  spoken.length = 0;
  cancel.mockClear();
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (u: Utterance) => {
        spoken.push(u);
        u.onstart?.();
      },
      cancel,
    },
  });
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "speechSynthesis");
});
const reply = { id: 1, text: "**Debt:** 12\n- first\n1. second", lang: "en-US" };
it("strips only supported reply markup while retaining words and numbers", () => {
  expect(stripReplyMarkup("**Debt:** 12\n- first\n* next\n1. second")).toBe(
    "Debt: 12\nfirst\nnext\nsecond",
  );
});
it("speaks a final reply once without markup and ends with the watchdog", () => {
  setup();
  const { result, rerender } = renderHook(({ message }) => useLiveReplySpeech(message, true), {
    initialProps: { message: reply as typeof reply | null },
  });
  expect(spoken.map((item) => item.text)).toEqual(["Debt: 12\nfirst\nsecond"]);
  expect(result.current.speaking).toBe(true);
  rerender({ message: { ...reply } });
  expect(spoken).toHaveLength(1);
  act(() => vi.advanceTimersByTime(10000));
  expect(result.current.speaking).toBe(false);
});
it("cancels on new turn, clear, sound off and unmount without replaying old ids", () => {
  setup();
  const { rerender, unmount } = renderHook(
    ({ message, sound }) => useLiveReplySpeech(message, sound),
    { initialProps: { message: reply as typeof reply | null, sound: true } },
  );
  rerender({ message: null, sound: true });
  const afterTurn = cancel.mock.calls.length;
  expect(afterTurn).toBeGreaterThan(0);
  rerender({ message: reply, sound: true });
  expect(spoken).toHaveLength(1);
  rerender({ message: { ...reply, id: 2 }, sound: true });
  rerender({ message: null, sound: true });
  expect(cancel.mock.calls.length).toBeGreaterThan(afterTurn);
  rerender({ message: { ...reply, id: 3 }, sound: true });
  const beforeMute = cancel.mock.calls.length;
  rerender({ message: { ...reply, id: 3 }, sound: false });
  expect(cancel.mock.calls.length).toBeGreaterThan(beforeMute);
  rerender({ message: { ...reply, id: 4 }, sound: true });
  const beforeUnmount = cancel.mock.calls.length;
  unmount();
  expect(cancel.mock.calls.length).toBeGreaterThan(beforeUnmount);
});
it("is silent without browser speech support", () => {
  const { result } = renderHook(() => useLiveReplySpeech(reply, true));
  expect(result.current.speaking).toBe(false);
});

it("keeps demo speaking until both text and audio finish and updates word cues", () => {
  setup();
  const { result } = renderHook(() => useReplySpeech(true));
  act(() => result.current.play(42, "Hello world", "id-ID", true, true));
  expect(spoken[0]?.lang).toBe("id-ID");
  act(() => spoken[0]?.onboundary?.({ name: "word", charIndex: 6 }));
  expect(result.current.cue.current.charIndex).toBe(6);
  act(() => spoken[0]?.onend?.());
  expect(result.current.speaking).toBe(true);
  act(() => result.current.finishText(42));
  expect(result.current.speaking).toBe(false);
});

it("retains live playback after strict-mode effect replay", () => {
  setup();
  const { result } = renderHook(() => useLiveReplySpeech(reply, true), { wrapper: StrictMode });
  expect(result.current.speaking).toBe(true);
  expect(spoken.at(-1)?.text).toBe("Debt: 12\nfirst\nsecond");
});

describe("spokenSummary", () => {
  it("keeps the first two sentences and leaves the rest to the screen", () => {
    expect(spokenSummary("First one. Second one! Third one. Fourth one.")).toBe(
      "First one. Second one!",
    );
  });
  it("does not split inside numbers, percents or token amounts", () => {
    expect(
      spokenSummary("Health would be 691.24% after borrowing 0.5 REF. Nothing is signed."),
    ).toBe("Health would be 691.24% after borrowing 0.5 REF. Nothing is signed.");
  });
  it("speaks a short reply whole, including line breaks and unpunctuated lines", () => {
    expect(spokenSummary("Debt: 12\nfirst\nsecond")).toBe("Debt: 12\nfirst\nsecond");
  });
  it("caps a very long sentence at a word boundary", () => {
    const long = `${"word ".repeat(80)}end.`;
    const out = spokenSummary(long);
    expect(out.length).toBeLessThanOrEqual(260);
    expect(out.endsWith("word")).toBe(true);
  });
  it("is empty for blank text", () => {
    expect(spokenSummary("  \n ")).toBe("");
  });
});

it("speaks and lip-syncs only the spoken summary of a long reply", () => {
  setup();
  const { result } = renderHook(() => useReplySpeech(true));
  act(() =>
    result.current.play(7, "Alpha is first. Beta is second. Gamma is third.", "en-US", true, false),
  );
  expect(spoken.at(-1)?.text).toBe("Alpha is first. Beta is second.");
  expect(result.current.cue.current.text).toBe("Alpha is first. Beta is second.");
});

describe("stopping a spoken reply", () => {
  const speak = () => {
    setup();
    return renderHook(
      ({ draft, busy }) => {
        const speech = useReplySpeech(true);
        useStopSpeechOnUserAction(speech.speaking, speech.cancel, draft, busy);
        return speech;
      },
      { initialProps: { draft: "", busy: false } },
    );
  };

  it("stops when the user starts typing, and not for an empty draft", () => {
    const { result, rerender } = speak();
    act(() => result.current.play(1, "Hello there.", "en-US", true, false));
    expect(result.current.speaking).toBe(true);
    rerender({ draft: "", busy: false });
    expect(result.current.speaking).toBe(true);
    rerender({ draft: "w", busy: false });
    expect(result.current.speaking).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("stops when a message is sent (busy), and when Escape is pressed while speaking", () => {
    const { result, rerender } = speak();
    act(() => result.current.play(1, "Hello there.", "en-US", true, false));
    rerender({ draft: "", busy: true });
    expect(result.current.speaking).toBe(false);
    act(() => result.current.play(2, "Hello again.", "en-US", true, false));
    expect(result.current.speaking).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.speaking).toBe(false);
  });

  it("ignores other keys, and Escape while nothing is speaking", () => {
    const { result } = speak();
    act(() => result.current.play(1, "Hello there.", "en-US", true, false));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(result.current.speaking).toBe(true);
    act(() => result.current.cancel());
    cancel.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(cancel).not.toHaveBeenCalled();
  });
});
