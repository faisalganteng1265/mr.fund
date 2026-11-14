import { describe, expect, it } from "vitest";
import { consultationEntrance, entranceEase } from "../src/play/consultationEntrance";
import { CONSULTATION_DESK } from "../src/play/consultationScene";

describe("standing office consultation entrance", () => {
  it("starts standing in the room and ends seated with a close frontal camera", () => {
    const standing = consultationEntrance(0, 1.6);
    const seated = consultationEntrance(1, 1.6);
    expect(standing.actor.x).toBeCloseTo(-2.2);
    expect(standing.actor.z).toBeCloseTo(1.7);
    expect(standing.actor.sit).toBe(0);
    expect(standing.actor.walk).toBe(0);
    expect(standing.typing).toBe(0);
    expect(seated.actor.x).toBeCloseTo(0);
    expect(seated.actor.z).toBeCloseTo(0);
    expect(seated.actor.sit).toBe(1);
    expect(seated.actor.walk).toBe(0);
    expect(seated.actor.yaw).toBeCloseTo(0);
    expect(seated.camera[0]).toBe(0);
    expect(seated.target[0]).toBeCloseTo(0);
    expect(seated.target.slice(1)).toEqual([2.2, 0]);
    expect(Math.hypot(...seated.camera)).toBeLessThan(Math.hypot(...standing.camera));
  });
  it("walks around the desk footprint before bending into the chair", () => {
    for (let step = 0; step <= 58; step++) {
      const frame = consultationEntrance(step / 100, 1.6);
      expect(frame.actor.sit).toBe(0);
      const insideDesk =
        Math.abs(frame.actor.x) < CONSULTATION_DESK.width / 2 + 0.3 &&
        frame.actor.z > CONSULTATION_DESK.back - 0.3 &&
        frame.actor.z < CONSULTATION_DESK.back + CONSULTATION_DESK.depth + 0.3;
      expect(insideDesk).toBe(false);
    }
    expect(consultationEntrance(0.29, 1.6).actor.walk).toBeGreaterThan(0.9);
    expect(consultationEntrance(0.68, 1.6).actor.sit).toBeCloseTo(0.5);
    expect(consultationEntrance(0.79, 1.6).actor.sit).toBe(1);
  });
  it("holds the room view until sitting, then zooms, and fits portrait", () => {
    expect(consultationEntrance(0.58, 1.6).camera).toEqual(consultationEntrance(0, 1.6).camera);
    expect(consultationEntrance(0.9, 1.6).camera[2]).toBeLessThan(
      consultationEntrance(0.7, 1.6).camera[2],
    );
    const phone = consultationEntrance(0, 0.4);
    expect(phone.camera[2]).toBeGreaterThan(consultationEntrance(0, 1.6).camera[2]);
    expect(entranceEase(-1)).toBe(0);
    expect(entranceEase(2)).toBe(1);
  });
});
