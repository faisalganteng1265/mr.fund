import { describe, expect, it, vi } from "vitest";
import { createPortraitResolution } from "../src/play/portraitResolution";

describe("portrait drawing buffer during entrance", () => {
  it("allocates once during sixty layout frames, then commits the final dimensions once", () => {
    const allocate = vi.fn();
    const resolution = createPortraitResolution(allocate);
    resolution.resize(1000, 700, 0);
    for (let frame = 1; frame <= 60; frame++) {
      resolution.resize(1000 - frame * 10, 700 - frame * 3, frame * 16);
      resolution.tick(frame * 16, false);
    }
    expect(allocate.mock.calls).toEqual([[1000, 700]]);
    resolution.tick(1100, true);
    expect(allocate.mock.calls).toEqual([
      [1000, 700],
      [400, 520],
    ]);
    resolution.tick(1200, true);
    expect(allocate).toHaveBeenCalledTimes(2);
  });
  it("waits for a normal resize to settle and ignores unchanged dimensions", () => {
    const allocate = vi.fn();
    const resolution = createPortraitResolution(allocate);
    resolution.resize(400, 500, 0);
    resolution.resize(500, 600, 100);
    resolution.tick(200, true);
    expect(allocate).toHaveBeenCalledTimes(1);
    resolution.tick(220, true);
    expect(allocate).toHaveBeenLastCalledWith(500, 600);
    resolution.resize(500, 600, 300);
    resolution.tick(500, true);
    expect(allocate).toHaveBeenCalledTimes(2);
  });
});
