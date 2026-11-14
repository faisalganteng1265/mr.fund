import { consultationEntrance, entranceEase } from "./consultationEntrance";

/** Keep a full standing figure in the left portion of a narrow conversation viewport. */
export function mobileConsultation(progress: number, aspect: number) {
  const initial = consultationEntrance(0, aspect);
  const t = entranceEase(progress);
  const distance = Math.max(
    10.4,
    2.9 / (2 * Math.tan((16 * Math.PI) / 180) * Math.max(0.2, aspect)),
  );
  const span = 2 * distance * Math.tan((16 * Math.PI) / 180) * aspect;
  const targetY = distance * Math.tan((16 * Math.PI) / 180) * 0.52;
  const mix = (from: number, to: number) => from + (to - from) * t;
  return {
    ...initial,
    camera: [
      mix(initial.camera[0], 0),
      mix(initial.camera[1], targetY + 0.1),
      mix(initial.camera[2], distance),
    ] as const,
    target: [
      mix(initial.target[0], 0),
      mix(initial.target[1], targetY),
      mix(initial.target[2], 0),
    ] as const,
    actor: {
      x: mix(initial.actor.x, -span * 0.31),
      z: mix(initial.actor.z, 0),
      yaw: 0,
      sit: 0,
      walk: 0,
      stride: 0,
    },
    typing: 0,
  };
}
