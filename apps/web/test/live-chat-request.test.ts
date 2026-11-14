import { describe, expect, it } from "vitest";
import { buildLiveChatRequest } from "../src/play/source/liveChatRequest";

const message = (content: string) => ({ role: "user" as const, content });
const build = (history: ReturnType<typeof message>[], text = "hello", locale?: string) =>
  buildLiveChatRequest({
    message: text,
    accountId: "alice.near",
    history,
    ...(locale === undefined ? {} : { locale }),
  });

describe("live chat request", () => {
  it("accepts message limits and rejects empty or oversized input", () => {
    expect(build([], "x".repeat(4000)).message).toHaveLength(4000);
    expect(() => build([], "x".repeat(4001))).toThrow();
    expect(() => build([], "  ")).toThrow();
  });

  it("keeps at most the latest 20 messages", () => {
    const history = Array.from({ length: 21 }, (_, index) => message(String(index)));
    expect(build(history.slice(1)).history).toEqual(history.slice(1));
    expect(build(history).history).toEqual(history.slice(1));
  });

  it("enforces per-message and total limits from the newest end", () => {
    const full = Array.from({ length: 4 }, () => message("a".repeat(4000)));
    expect(build(full).history).toEqual(full);
    expect(build([message("x"), ...full]).history).toEqual(full);
    expect(build([message("old"), message("x".repeat(4001)), message("new")]).history).toEqual([
      message("new"),
    ]);
  });

  it("only sends supported locales", () => {
    expect(build([], "hi", "id").locale).toBe("id");
    expect(build([], "hi", "fr")).not.toHaveProperty("locale");
  });
});
