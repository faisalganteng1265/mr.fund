// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoicePanel } from "../src/play/VoicePanel";
import { VoiceInputFakeRecognizer } from "./voiceInput-fakes";

let recognizers: VoiceInputFakeRecognizer[];
class BrowserRecognizer extends VoiceInputFakeRecognizer {
  constructor() {
    super();
    recognizers.push(this);
  }
}
function latest() {
  const recognizer = recognizers.at(-1);
  if (!recognizer) throw new Error("Expected a browser recognizer");
  return recognizer;
}
function mount(props: { busy?: boolean; live?: boolean } = {}) {
  const onSend = vi.fn();
  const onNotice = vi.fn();
  const rendered = render(createElement(VoicePanel, { onSend, onNotice, ...props }));
  return { ...rendered, onSend, onNotice };
}
function start() {
  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
  expect(screen.getByRole("button", { name: "Starting voice input. Tap to stop." })).toBeTruthy();
  act(() => latest().ready());
}

beforeEach(() => {
  vi.useFakeTimers();
  recognizers = [];
  vi.stubGlobal("SpeechRecognition", BrowserRecognizer);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Removing machine integration, transcript retention or the manual-send lock breaks these.
it("toggles on, survives a pause and sends only an explicitly reviewed question after stop", () => {
  const { onSend, onNotice } = mount({ live: true });
  start();
  expect(latest().continuous).toBe(true);
  expect(latest().interimResults).toBe(true);
  expect(screen.getByRole("button", { name: "Listening. Tap to stop." })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Bahasa Indonesia" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  act(() => latest().result(["What is my debt", true]));
  expect(
    (screen.getByRole("button", { name: "Send my question" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  act(() => {
    vi.advanceTimersByTime(5_000);
    latest().end();
  });
  expect(recognizers).toHaveLength(2);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("What is my debt");
  act(() => {
    latest().ready();
    latest().result(["and my limits", false]);
  });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "What is my debt and my limits",
  );
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Listening. Tap to stop." }));
  expect(screen.getByRole("button", { name: "Stopping voice input." })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Send my question" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  act(() => latest().end());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain my limits instead" } });
  fireEvent.click(screen.getByRole("button", { name: "Send my question" }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith("Explain my limits instead");
  expect(onNotice).toHaveBeenCalledWith("Your transcript was sent to Mr.Fund.");
});

it("shows the exact silence notice at 60 seconds with editable, unsent words", () => {
  const { onSend } = mount();
  start();
  act(() => latest().result(["Keep this question", true]));
  act(() => vi.advanceTimersByTime(59_999));
  expect(screen.queryByText("Stopped after a minute of silence. Your words are kept.")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByText("Stopped after a minute of silence. Your words are kept.")).toBeTruthy();
  act(() => latest().end());
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep this question");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Reviewed question" } });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Reviewed question");
  expect(onSend).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "Send my question" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it.each(["not-allowed", "service-not-allowed"])("announces %s and does not restart", (error) => {
  const { onSend } = mount();
  start();
  act(() => latest().result(["My words", true]));
  act(() => {
    latest().error(error);
    latest().end();
    vi.advanceTimersByTime(5_000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Microphone permission wasn't granted");
  expect(screen.getByRole("button", { name: "Retry voice input" })).toBeTruthy();
  expect(recognizers).toHaveLength(1);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("My words");
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry voice input" }));
  expect(recognizers).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("allows typing and manual send without recognition support", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  const { onSend } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
  expect(screen.getByRole("alert").textContent).toContain("isn't available");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Typed question" } });
  fireEvent.click(screen.getByRole("button", { name: "Send my question" }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith("Typed question");
});

it("supports the prefixed browser recognizer and locks the chosen recognition language", () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", BrowserRecognizer);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Bahasa Indonesia" }));
  start();
  expect(latest().lang).toBe("id-ID");
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(latest().lang).toBe("id-ID");
});

it("keeps samples labelled simulated and disables sample replacement during capture", () => {
  const { onSend, onNotice } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Try a demo transcript" }));
  expect(screen.getByText("SAMPLE TRANSCRIPT · SIMULATED")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send my question" }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith("What if NEAR drops 20%?");
  expect(onNotice).toHaveBeenCalledWith(
    "A labelled voice sample was sent to the scripted demo chat.",
  );
  start();
  expect(
    (screen.getByRole("button", { name: "Try a demo transcript" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByText("SAMPLE TRANSCRIPT · SIMULATED")).toBeNull();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});

it("keeps sending disabled while chat is busy, including a typed draft", () => {
  const { onSend } = mount({ busy: true });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Please explain" } });
  fireEvent.click(screen.getByRole("button", { name: "Send my question" }));
  expect(onSend).not.toHaveBeenCalled();
});

it("aborts capture on unmount and ignores late browser callbacks", () => {
  const { unmount, onSend } = mount();
  start();
  const recognizer = latest();
  const lateEnd = recognizer.onend;
  unmount();
  act(() => {
    lateEnd?.();
    vi.advanceTimersByTime(300_000);
  });
  expect(recognizer.aborts).toBe(1);
  expect(recognizers).toHaveLength(1);
  expect(onSend).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("still starts recognition after React strict-mode effect cleanup", () => {
  render(
    createElement(
      StrictMode,
      null,
      createElement(VoicePanel, { onSend: vi.fn(), onNotice: vi.fn() }),
    ),
  );
  start();
  act(() => latest().result(["still listening", true]));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("still listening");
});
