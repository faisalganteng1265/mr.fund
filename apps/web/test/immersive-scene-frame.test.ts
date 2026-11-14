// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImmersiveSceneFrame } from "../src/play/ImmersiveSceneFrame";

const animate = vi.fn(
  (_frames: Keyframe[] | PropertyIndexedKeyframes, _options?: KeyframeAnimationOptions) => ({
    cancel: vi.fn(),
  }),
);
beforeEach(() => {
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("fixed")) {
      const width = this.style.width.endsWith("vw")
        ? window.innerWidth
        : Number.parseFloat(this.style.width);
      const height = this.style.height.endsWith("dvh")
        ? window.innerHeight
        : Number.parseFloat(this.style.height);
      return new DOMRect(
        Number.parseFloat(this.style.left),
        Number.parseFloat(this.style.top),
        width,
        height,
      );
    }
    return new DOMRect(32, 88, 300, 650);
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  animate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});
const frame = (immersive: boolean) =>
  createElement(
    ImmersiveSceneFrame,
    { immersive },
    createElement("span", null, "Scene stays mounted"),
  );

it("moves one scene from full screen into its slot without remounting its children", () => {
  const view = render(frame(true));
  const child = screen.getByText("Scene stays mounted");
  expect(child.parentElement?.style.width).toBe("1280px");
  expect(child.parentElement?.style.height).toBe("800px");
  view.rerender(frame(false));
  expect(screen.getByText("Scene stays mounted")).toBe(child);
  expect(child.parentElement?.style.width).toBe("300px");
  expect(animate).toHaveBeenCalledOnce();
  expect(animate.mock.calls[0]?.[0]).toEqual([
    { left: "0px", top: "0px", width: "1280px", height: "800px", borderRadius: "0px" },
    { left: "32px", top: "88px", width: "300px", height: "650px", borderRadius: "28px" },
  ]);
});
it("uses the final slot immediately for reduced motion", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const view = render(frame(true));
  view.rerender(frame(false));
  expect(animate).not.toHaveBeenCalled();
  expect(screen.getByText("Scene stays mounted").parentElement?.style.top).toBe("88px");
});
