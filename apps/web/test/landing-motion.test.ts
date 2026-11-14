// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPreview } from "../src/landing/ConversationPreview";
import { conversation } from "../src/landing/conversation";
import { landingFigures } from "../src/landing/figures";
import { LandingMotion, MotionToggle } from "../src/landing/LandingMotion";

const fixture = vi.hoisted(() => ({
  mount: vi.fn(),
  dispose: vi.fn(),
  standing: false,
  active: false,
}));
vi.mock("../src/landing/motionScene", () => ({
  mountLandingMotion: (...args: unknown[]) => {
    fixture.mount(...args);
    return fixture.dispose;
  },
}));
vi.mock("next/dynamic", () => ({
  default: () => (props: { standing?: boolean; active: boolean }) => {
    fixture.standing = props.standing ?? false;
    fixture.active = props.active;
    return createElement("div", { "data-testid": "live-character" });
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function advance(time: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
}

describe("landing motion controls", () => {
  it("reveals replies progressively and preserves progress across a pause", async () => {
    const f = landingFigures();
    render(createElement(ConversationPreview, { figures: f }));
    await advance(500);
    const answer = screen.getByTestId("hero-answer");
    const partial = answer.textContent ?? "";
    expect(partial.length).toBeGreaterThan(5);
    expect(partial.length).toBeLessThan(conversation(f)[0].answer.length);
    fireEvent.click(screen.getByRole("button", { name: "Pause conversation demo" }));
    await advance(1500);
    expect(answer.textContent).toBe(partial);
    fireEvent.click(screen.getByRole("button", { name: "Resume conversation demo" }));
    await advance(400);
    expect(answer.textContent?.startsWith(partial)).toBe(true);
    expect(answer.textContent?.length).toBeGreaterThan(partial.length);
  });
  it("switches demo topics through thinking and starts each answer from its first character", async () => {
    const stories = conversation(landingFigures());
    render(createElement(ConversationPreview, { figures: landingFigures() }));
    await advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Market dip" }));
    expect(screen.getByText(stories[2].question)).toBeTruthy();
    expect(screen.getByRole("status", { name: "Mr.Fund is thinking" })).toBeTruthy();
    await advance(1900);
    expect(screen.queryByTestId("hero-answer")).toBeNull();
    await advance(100);
    await advance(200);
    const partial = screen.getByTestId("hero-answer").textContent ?? "";
    expect(stories[2].answer.startsWith(partial)).toBe(true);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(20);
    fireEvent.click(screen.getByRole("button", { name: "My position" }));
    await advance(2000);
    await advance(200);
    const restarted = screen.getByTestId("hero-answer").textContent ?? "";
    expect(stories[0].answer.startsWith(restarted)).toBe(true);
    expect(restarted.length).toBeLessThan(20);
  });
  it("restarts progressive text when the automatic loop advances", async () => {
    const stories = conversation(landingFigures());
    render(createElement(ConversationPreview, { figures: landingFigures() }));
    await advance(Math.ceil(stories[0].answer.length / 2) * 40);
    await advance(3400);
    await advance(1000);
    await advance(2000);
    await advance(200);
    expect(screen.getByText(stories[1].question)).toBeTruthy();
    const partial = screen.getByTestId("hero-answer").textContent ?? "";
    expect(stories[1].answer.startsWith(partial)).toBe(true);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(20);
  });
  it("releases scroll animation resources when paused or unmounted", () => {
    const view = render(createElement(LandingMotion, null, createElement(MotionToggle)));
    expect(fixture.mount).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Pause page animations" }));
    expect(fixture.dispose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Resume page animations" }));
    expect(fixture.mount).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(fixture.dispose).toHaveBeenCalledTimes(2);
  });
  it("shows a complete static answer and avoids scroll effects with reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const f = landingFigures();
    render(
      createElement(
        LandingMotion,
        null,
        createElement(MotionToggle),
        createElement(ConversationPreview, { figures: f }),
      ),
    );
    expect(fixture.mount).not.toHaveBeenCalled();
    expect(screen.getByTestId("hero-answer").textContent).toBe(conversation(f)[0].answer);
    expect(
      screen.getByRole("button", { name: "Reduced motion is enabled" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
