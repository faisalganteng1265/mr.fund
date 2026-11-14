// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatBubbleClass } from "../src/play/chatAppearance";
import { LiveChatPanel } from "../src/play/LivePanels";
import { isSlow } from "../src/play/live/liveSlow";
import type { LivePositionState } from "../src/play/source/livePosition";

afterEach(cleanup);

type Message = { id: number; role: "user" | "assistant"; content: string };
function fakeLive(over: Record<string, unknown> = {}) {
  return {
    state: { status: "empty" } as LivePositionState,
    messages: [] as Message[],
    input: "",
    setInput: vi.fn(),
    partial: "",
    card: null,
    error: "",
    busy: false,
    progress: "",
    send: vi.fn(async () => {}),
    clear: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}
function panel(live: ReturnType<typeof fakeLive>) {
  HTMLElement.prototype.scrollTo = vi.fn();
  return render(
    createElement(LiveChatPanel, {
      live: live as never,
      repay: { store: null, view: { phase: "idle" } } as never,
      opening: { store: null, view: { phase: "idle" } } as never,
      phone: false,
      setComposerFocused: () => {},
      setKeyboardHeight: () => {},
      openPanel: () => {},
    }),
  );
}

describe("isSlow", () => {
  it("is false when the hook has no slow field yet", () => {
    expect(isSlow({ busy: true })).toBe(false);
  });
  it("follows the slow field once it exists", () => {
    expect(isSlow({ slow: true })).toBe(true);
    expect(isSlow({ slow: false })).toBe(false);
    expect(isSlow({ slow: "yes" })).toBe(false);
  });
});

describe("live chat looks like the demo chat", () => {
  it("opens with a Mr.Fund bubble and avatar instead of a bare prompt line", () => {
    const { container } = panel(fakeLive());
    expect(screen.queryByText("Ask about your Rhea position.")).toBeNull();
    expect(screen.getByText(/I don't see a Rhea lending position/)).toBeTruthy();
    const row = container.querySelector(".chat-message");
    expect(row?.textContent).toContain("m.");
    expect(row?.querySelector("[aria-hidden='true']")?.textContent).toBe("m.");
  });

  it("uses the demo bubble classes for both roles", () => {
    const { container } = panel(
      fakeLive({
        messages: [
          { id: 1, role: "user", content: "Explain my position" },
          { id: 2, role: "assistant", content: "Fine." },
        ],
      }),
    );
    const bubbles = Array.from(container.querySelectorAll(".chat-message > div:last-child"));
    expect(bubbles.map((b) => b.className)).toEqual([
      chatBubbleClass("assistant"),
      chatBubbleClass("user"),
      chatBubbleClass("assistant"),
    ]);
  });

  it("renders bold and bullets from an assistant reply without asterisks", () => {
    const { container } = panel(
      fakeLive({
        messages: [
          { id: 1, role: "user", content: "Explain" },
          { id: 2, role: "assistant", content: "**Debt:** none\n\n- one\n- two\n- three" },
        ],
      }),
    );
    expect(container.querySelector("strong")?.textContent).toBe("Debt:");
    expect(container.querySelectorAll("ul > li")).toHaveLength(3);
    expect(container.textContent).not.toContain("**");
  });

  it("shows a user message literally, including markup characters", () => {
    const { container } = panel(
      fakeLive({ messages: [{ id: 1, role: "user", content: "**hi** <b>x</b>" }] }),
    );
    expect(container.querySelector("b, strong")).toBeNull();
    expect(screen.getByText("**hi** <b>x</b>")).toBeTruthy();
  });

  it("shows the stage text while thinking and a still-thinking message when slow", () => {
    const first = panel(fakeLive({ busy: true, progress: "Reading your position…" }));
    expect(within(first.container).getByRole("status").textContent).toContain(
      "Reading your position…",
    );
    cleanup();
    panel(fakeLive({ busy: true, progress: "Reading your position…", slow: true }));
    expect(screen.getByRole("status").textContent).toContain("Still thinking…");
    expect(screen.getByRole("status").textContent).not.toContain("Reading your position…");
  });

  it("keeps the composer usable while a turn runs so a new message can replace it", () => {
    panel(fakeLive({ busy: true, slow: true, input: "next question" }));
    const box = screen.getByRole("textbox", { name: "Message Mr.Fund" }) as HTMLTextAreaElement;
    expect(box.disabled).toBe(false);
  });

  it("shows an error with Retry that sends the restored text", () => {
    const live = fakeLive({
      error: "The assistant is unavailable. Please try again.",
      input: "Explain",
    });
    panel(live);
    expect(screen.getByRole("alert").textContent).toContain("The assistant is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(live.send).toHaveBeenCalledWith("Explain");
  });

  it("offers no Retry when there is no text to resend", () => {
    panel(fakeLive({ error: "The assistant is unavailable. Please try again.", input: "" }));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

const chips = () =>
  within(screen.getByRole("group", { name: "Suggested questions" }))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("live suggestion chips", () => {
  it("explains concepts and Guardian, never a repay, for an account without a position", () => {
    panel(fakeLive({ state: { status: "empty" } }));
    expect(chips()).toEqual([
      "What is health factor?",
      "How does Guardian work?",
      "What can you do?",
    ]);
  });

  it("offers position questions when the position is ready", () => {
    panel(fakeLive({ state: { status: "ready", position: {} } }));
    expect(chips()).toEqual(["Explain my position", "What if NEAR drops 20%?", "Should I repay?"]);
  });

  it("puts refresh first when the data is stale and refreshes instead of sending", () => {
    const live = fakeLive({ state: { status: "stale" } });
    panel(live);
    expect(chips()[0]).toBe("Refresh position");
    fireEvent.click(screen.getByRole("button", { name: "Refresh position" }));
    expect(live.refresh).toHaveBeenCalledTimes(1);
    expect(live.send).not.toHaveBeenCalled();
  });

  it("offers a refresh when the position is unavailable", () => {
    panel(fakeLive({ state: { status: "unavailable" } }));
    expect(chips()[0]).toBe("Refresh position");
  });

  it("sends a question through live.send when a chip is clicked", () => {
    const live = fakeLive({ state: { status: "empty" } });
    panel(live);
    fireEvent.click(screen.getByRole("button", { name: "What can you do?" }));
    expect(live.send).toHaveBeenCalledWith("What can you do?");
  });

  it("hides every chip while a turn is busy", () => {
    panel(fakeLive({ state: { status: "ready", position: {} }, busy: true }));
    expect(screen.queryByRole("group", { name: "Suggested questions" })).toBeNull();
  });

  it("shows no chips while loading or on a network mismatch", () => {
    panel(fakeLive({ state: { status: "loading" } }));
    expect(screen.queryByRole("group", { name: "Suggested questions" })).toBeNull();
    cleanup();
    panel(fakeLive({ state: { status: "network_mismatch" } }));
    expect(screen.queryByRole("group", { name: "Suggested questions" })).toBeNull();
  });

  it("keeps follow-up chips after the first answer and only a refresh after a failed turn", () => {
    panel(
      fakeLive({
        state: { status: "ready", position: {} },
        messages: [
          { id: 1, role: "user", content: "Explain" },
          { id: 2, role: "assistant", content: "Fine." },
        ],
      }),
    );
    expect(chips()).toHaveLength(3);
    cleanup();
    panel(fakeLive({ state: { status: "ready", position: {} }, error: "x", input: "Explain" }));
    expect(chips()).toEqual(["Refresh position"]);
  });
});

describe("keyboard focus after a chip", () => {
  const textbox = () => screen.getByRole("textbox", { name: "Message Mr.Fund" });
  it("returns focus to the composer when a chip is used from the keyboard", () => {
    panel(fakeLive({ state: { status: "empty" } }));
    fireEvent.click(screen.getByRole("button", { name: "What can you do?" }), { detail: 0 });
    expect(document.activeElement).toBe(textbox());
  });
  it("leaves focus alone for a pointer click so a phone keyboard does not pop up", () => {
    panel(fakeLive({ state: { status: "empty" } }));
    fireEvent.click(screen.getByRole("button", { name: "What can you do?" }), { detail: 1 });
    expect(document.activeElement).not.toBe(textbox());
  });
  it("also returns focus after a keyboard refresh chip", () => {
    panel(fakeLive({ state: { status: "stale" } }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh position" }), { detail: 0 });
    expect(document.activeElement).toBe(textbox());
  });
});
