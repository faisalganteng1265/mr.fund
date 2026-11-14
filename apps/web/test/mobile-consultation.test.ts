import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { consultationEntrance } from "../src/play/consultationEntrance";
import { mobileConsultation } from "../src/play/mobileConsultation";

describe("standing phone consultation", () => {
  it("starts at the existing welcome view and stays standing throughout the transition", () => {
    const aspect = 390 / 844;
    const first = mobileConsultation(0, aspect);
    expect(first.camera).toEqual(consultationEntrance(0, aspect).camera);
    expect(first.actor.x).toBeCloseTo(-2.2);
    for (let i = 0; i <= 100; i++) {
      const frame = mobileConsultation(i / 100, aspect);
      expect(frame.actor.sit).toBe(0);
      expect(frame.actor.walk).toBe(0);
      expect(frame.typing).toBe(0);
    }
  });
  it("frames the head and feet on the left, above the composer/dock on narrow phones", () => {
    for (const [width, height] of [
      [320, 568],
      [360, 800],
      [390, 844],
      [430, 932],
    ]) {
      if (!width || !height) throw new Error("Invalid fixture");
      const frame = mobileConsultation(1, width / height);
      const camera = new PerspectiveCamera(32, width / height, 0.1, 40);
      camera.position.set(...frame.camera);
      camera.lookAt(new Vector3(...frame.target));
      camera.updateMatrixWorld(true);
      const head = new Vector3(frame.actor.x, 3.9, 0).project(camera);
      const feet = new Vector3(frame.actor.x, 0, 0).project(camera);
      const x = (head.x + 1) / 2;
      const top = (1 - head.y) / 2;
      const bottom = (1 - feet.y) / 2;
      expect(x).toBeGreaterThan(0.1);
      expect(x).toBeLessThan(0.25);
      expect(top).toBeGreaterThan(0.07);
      expect(top).toBeLessThan(0.4);
      expect(bottom).toBeLessThan(0.82);
      expect(bottom - top).toBeGreaterThan(0.45);
    }
  });
});
