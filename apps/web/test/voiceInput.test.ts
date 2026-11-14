import { describe, expect, it } from "vitest";
import { createVoiceInput } from "../src/play/speech/voiceInput";
import { VoiceInputFakeClock, voiceInputRecognizerFactory } from "./voiceInput-fakes";

function setup() {
  const clock = new VoiceInputFakeClock();
  const factory = voiceInputRecognizerFactory();
  const input = createVoiceInput({ clock, createRecognizer: factory.createRecognizer });
  return { clock, ...factory, input };
}

// These tests catch lost transcripts, early/late deadlines and unintended restarts.
describe("voice input session", () => {
  it("exposes starting, listening, stopping and idle on explicit toggle", () => {
    const { input, latest, clock } = setup();
    const states: string[] = [];
    input.subscribe(() => states.push(input.getSnapshot().state));
    input.toggle();
    expect(input.getSnapshot().state).toBe("starting");
    expect(latest().lang).toBe("en-US");
    expect(latest().continuous).toBe(true);
    expect(latest().interimResults).toBe(true);
    latest().ready();
    input.toggle();
    expect(latest().stops).toBe(1);
    expect(input.getSnapshot().state).toBe("stopping");
    latest().end();
    expect(states).toEqual(["starting", "listening", "stopping", "idle"]);
    expect(clock.pending).toBe(0);
  });

  it("can stop before start arrives and does not re-enable listening on a late start", () => {
    const { input, latest, recognizers } = setup();
    input.start();
    input.toggle();
    latest().ready();
    expect(input.getSnapshot().state).toBe("stopping");
    latest().end();
    expect(input.getSnapshot().state).toBe("idle");
    expect(recognizers).toHaveLength(1);
  });

  it("accumulates each final once, replaces interim and keeps final words across a pause", () => {
    const { input, latest, clock, recognizers } = setup();
    input.setTranscript("Please explain");
    input.start();
    latest().ready();
    latest().result(["my loan", true], ["and", false]);
    latest().result(["my loan", true], ["and my limits", false]);
    expect(input.getSnapshot().transcript).toBe("Please explain my loan and my limits");
    latest().result(["my loan", true], ["and my limits", true]);
    clock.advance(5_000);
    latest().end();
    expect(input.getSnapshot().state).toBe("starting");
    expect(input.getSnapshot().transcript).toBe("Please explain my loan and my limits");
    expect(recognizers).toHaveLength(2);
    latest().ready();
    latest().result(["in plain words", false]);
    latest().result(["in plain words", true]);
    expect(input.getSnapshot().transcript).toBe(
      "Please explain my loan and my limits in plain words",
    );
  });

  it("keeps interim words visible through end and replaces them on the next attempt", () => {
    const { input, latest, clock } = setup();
    input.start();
    latest().result(["My debt", true], ["maybe", false]);
    clock.advance(5_000);
    latest().end();
    expect(input.getSnapshot().transcript).toBe("My debt maybe");
    latest().result(["what are my limits", false]);
    expect(input.getSnapshot().transcript).toBe("My debt what are my limits");
  });

  it("preserves manual edits and does not replay previously final results", () => {
    const { input, latest } = setup();
    input.start();
    latest().result(["my lone", true]);
    input.setTranscript("my loan");
    latest().result(["my lone", true], ["please", true]);
    expect(input.getSnapshot().transcript).toBe("my loan please");
    input.stop();
    latest().end();
    input.setTranscript("edited question");
    input.start();
    latest().result(["thank you", true]);
    expect(input.getSnapshot().transcript).toBe("edited question thank you");
  });

  it("lets an edit override the current interim segment without later recognition undoing it", () => {
    const { input, latest } = setup();
    input.start();
    latest().result(["my lone", false]);
    input.setTranscript("my loan");
    latest().result(["my loan balance", true], ["please explain", false]);
    expect(input.getSnapshot().transcript).toBe("my loan please explain");
  });

  it("keeps the review draft at stop, including a final result delivered while stopping", () => {
    const { input, latest } = setup();
    input.start();
    latest().result(["my loan", false]);
    input.stop();
    latest().result(["my loan balance", true]);
    latest().end();
    expect(input.getSnapshot()).toMatchObject({ state: "idle", transcript: "my loan balance" });
  });

  it("locks language from starting through stopping and applies a later selection", () => {
    const { input, latest } = setup();
    input.setLanguage("id-ID");
    input.start();
    input.setLanguage("en-US");
    expect(latest().lang).toBe("id-ID");
    latest().ready();
    input.setLanguage("en-US");
    input.stop();
    input.setLanguage("en-US");
    expect(input.getSnapshot().language).toBe("id-ID");
    latest().end();
    input.setLanguage("en-US");
    input.start();
    expect(latest().lang).toBe("en-US");
  });

  it("stops at exactly 60 seconds of silence and retains the editable draft", () => {
    const { input, latest, clock } = setup();
    input.setTranscript("keep these words");
    input.start();
    latest().ready();
    clock.advance(59_999);
    expect(input.getSnapshot().state).toBe("listening");
    clock.advance(1);
    expect(input.getSnapshot()).toMatchObject({
      state: "stopping",
      transcript: "keep these words",
      notice: "Stopped after a minute of silence. Your words are kept.",
    });
    expect(latest().stops).toBe(1);
    latest().end();
    input.setTranscript("reviewed words");
    expect(input.getSnapshot().transcript).toBe("reviewed words");
    expect(clock.pending).toBe(0);
  });

  it("resets silence on every result, not on browser restarts or start events", () => {
    const { input, latest, clock } = setup();
    input.start();
    clock.advance(50_000);
    latest().result(["hello", false]);
    clock.advance(30_000);
    latest().end();
    latest().ready();
    clock.advance(29_999);
    expect(input.getSnapshot().state).toBe("listening");
    clock.advance(1);
    expect(input.getSnapshot().state).toBe("stopping");
  });

  it("enforces a 300 second hard cap even with frequent results", () => {
    const { input, latest, clock } = setup();
    input.start();
    latest().ready();
    for (let i = 0; i < 5; i++) {
      clock.advance(50_000);
      latest().result([`speech ${i}`, false]);
    }
    clock.advance(49_999);
    expect(input.getSnapshot().state).toBe("listening");
    clock.advance(1);
    expect(input.getSnapshot()).toMatchObject({
      state: "stopping",
      notice: "Stopped after five minutes. Your words are kept.",
      transcript: "speech 4",
    });
  });

  it("keeps the original hard cap through browser restarts", () => {
    const { input, latest, clock, recognizers } = setup();
    input.start();
    for (let i = 0; i < 5; i++) {
      clock.advance(50_000);
      latest().result(["spoken words", true]);
      latest().end();
      latest().ready();
    }
    clock.advance(49_999);
    expect(input.getSnapshot().state).toBe("listening");
    clock.advance(1);
    expect(input.getSnapshot().notice).toBe("Stopped after five minutes. Your words are kept.");
    latest().end();
    expect(recognizers).toHaveLength(6);
    expect(input.getSnapshot().state).toBe("idle");
  });

  it("starts silence and hard-cap timing at the tap, not the delayed browser start", () => {
    const { input, latest, clock } = setup();
    input.start();
    clock.advance(59_999);
    latest().ready();
    clock.advance(1);
    expect(input.getSnapshot().state).toBe("stopping");
  });

  it("allows three rapid empty restarts and stops the fourth within the inclusive 2 second boundary", () => {
    const { input, latest, clock, recognizers } = setup();
    input.start();
    for (let i = 0; i < 3; i++) {
      clock.advance(2_000);
      latest().end();
      expect(input.getSnapshot().state).toBe("starting");
    }
    clock.advance(2_000);
    latest().end();
    expect(input.getSnapshot()).toMatchObject({ state: "error", notice: "Voice input stopped" });
    expect(recognizers).toHaveLength(4);
    expect(clock.pending).toBe(0);
  });

  it.each(["result", "long attempt"])("resets the rapid restart guard after a %s", (reset) => {
    const { input, latest, clock } = setup();
    input.start();
    for (let i = 0; i < 3; i++) {
      clock.advance(100);
      latest().end();
    }
    if (reset === "result") latest().result(["new words", false]);
    clock.advance(reset === "result" ? 100 : 2_001);
    latest().end();
    expect(input.getSnapshot().state).toBe("starting");
    for (let i = 0; i < 2; i++) {
      clock.advance(100);
      latest().end();
      expect(input.getSnapshot().state).toBe("starting");
    }
  });

  it.each([
    ["not-allowed", "Microphone permission wasn't granted"],
    ["service-not-allowed", "Microphone permission wasn't granted"],
    ["audio-capture", "No microphone is available"],
    ["network", "Voice input lost its connection"],
    ["unknown", "Voice input stopped"],
  ])("stops %s without restart and allows an explicit retry", (error, message) => {
    const { input, latest, clock, recognizers } = setup();
    input.start();
    latest().result(["keep my question", true]);
    const staleEnd = latest().onend;
    latest().error(error);
    staleEnd?.();
    clock.advance(10_000);
    expect(input.getSnapshot()).toMatchObject({ state: "error", transcript: "keep my question" });
    expect(input.getSnapshot().error).toContain(message);
    expect(recognizers).toHaveLength(1);
    expect(clock.pending).toBe(0);
    input.start();
    expect(input.getSnapshot()).toMatchObject({ state: "starting", error: null, notice: null });
    expect(recognizers).toHaveLength(2);
  });

  it("handles no-speech through end without resetting silence or losing words", () => {
    const { input, latest, clock } = setup();
    input.start();
    latest().ready();
    latest().result(["my question", true]);
    clock.advance(55_000);
    latest().error("no-speech");
    latest().end();
    latest().ready();
    expect(input.getSnapshot().transcript).toBe("my question");
    clock.advance(5_000);
    expect(input.getSnapshot().notice).toBe(
      "Stopped after a minute of silence. Your words are kept.",
    );
  });

  it("reports absent recognition support while leaving typing available", () => {
    const clock = new VoiceInputFakeClock();
    const input = createVoiceInput({ clock, createRecognizer: () => null });
    input.start();
    expect(input.getSnapshot().state).toBe("error");
    expect(input.getSnapshot().error).toContain("isn't available");
    input.setTranscript("typed instead");
    expect(input.getSnapshot().transcript).toBe("typed instead");
    expect(clock.pending).toBe(0);
  });

  it("handles construction and start exceptions without leaving timers or listening intent", () => {
    const clock = new VoiceInputFakeClock();
    const input = createVoiceInput({
      clock,
      createRecognizer: () => {
        throw new Error("device");
      },
    });
    input.start();
    expect(input.getSnapshot().state).toBe("error");
    expect(clock.pending).toBe(0);
    const setupStart = setup();
    const broken = setupStart.createRecognizer();
    broken.startError = true;
    const brokenInput = createVoiceInput({ clock, createRecognizer: () => broken });
    brokenInput.start();
    expect(brokenInput.getSnapshot().state).toBe("error");
    broken.end();
    expect(broken.starts).toBe(1);
    expect(clock.pending).toBe(0);
  });

  it("recovers from stop exceptions by aborting without a restart", () => {
    const { input, latest, recognizers, clock } = setup();
    input.start();
    latest().stopError = true;
    input.stop();
    expect(input.getSnapshot().state).toBe("idle");
    expect(latest().aborts).toBe(1);
    latest().end();
    expect(recognizers).toHaveLength(1);
    expect(clock.pending).toBe(0);
  });

  it("ignores detached attempt callbacks, duplicate starts and post-disposal work", () => {
    const { input, latest, clock, recognizers } = setup();
    let changes = 0;
    const unsubscribe = input.subscribe(() => changes++);
    input.start();
    const stale = { start: latest().onstart, result: latest().onresult, end: latest().onend };
    input.start();
    expect(recognizers).toHaveLength(1);
    clock.advance(5_000);
    latest().end();
    stale.start?.();
    stale.result?.({ results: [{ 0: { transcript: "obsolete" }, isFinal: true }] });
    stale.end?.();
    expect(input.getSnapshot()).toMatchObject({ state: "starting", transcript: "" });
    expect(recognizers).toHaveLength(2);
    unsubscribe();
    const before = changes;
    input.dispose();
    input.start();
    input.setTranscript("obsolete edit");
    latest().ready();
    clock.advance(300_000);
    expect(input.getSnapshot().transcript).toBe("");
    expect(latest().aborts).toBe(1);
    expect(clock.pending).toBe(0);
    expect(changes).toBe(before);
  });
});
