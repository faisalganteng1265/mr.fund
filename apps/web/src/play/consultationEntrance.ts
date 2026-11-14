import { CatmullRomCurve3, Vector3 } from "three";
import { CONSULTATION_LAPTOP } from "./consultationScene";

export const ENTRANCE_SECONDS = 4.8;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const entranceEase = (value: number) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const route = new CatmullRomCurve3(
  [
    new Vector3(-2.2, 0, 1.7),
    new Vector3(-1.9, 0, 0.2),
    new Vector3(-1.8, 0, -0.3),
    new Vector3(-0.9, 0, -0.3),
    new Vector3(0, 0, 0),
  ],
  false,
  "centripetal",
);
const routeLength = route.getLength();

/** Walk around the desk, turn to the visitor, sit, then bring the camera into the conversation. */
export function consultationEntrance(progress: number, aspect: number) {
  const walkProgress = clamp(progress / 0.58);
  const distance = entranceEase(walkProgress);
  const point = route.getPointAt(distance);
  const tangent = route.getTangentAt(distance);
  const walking =
    entranceEase(walkProgress / 0.13) * (1 - entranceEase((walkProgress - 0.84) / 0.16));
  const faceVisitor = entranceEase((walkProgress - 0.82) / 0.18);
  const turnFromStanding = entranceEase(walkProgress / 0.13);
  const yaw = Math.atan2(tangent.x, tangent.z) * turnFromStanding * (1 - faceVisitor);
  const sit = entranceEase((progress - 0.58) / 0.2);
  const zoom = entranceEase((progress - 0.76) / 0.24);
  const fit = Math.max(1, (0.65 + zoom * 0.15) / Math.max(0.1, aspect));
  const target = [-0.8 * (1 - zoom), 1.85 + zoom * 0.35, 0.3 * (1 - zoom)] as const;
  return {
    camera: [
      target[0] + 4.8 * (1 - zoom) * fit,
      target[1] + (1.35 - zoom * 1.1) * fit,
      target[2] + (7.5 - zoom * 4.3) * fit,
    ] as const,
    target,
    actor: {
      x: point.x,
      z: point.z,
      yaw,
      walk: walking,
      stride: distance * routeLength * 4.2,
      sit,
    },
    laptopX: CONSULTATION_LAPTOP.x,
    laptopScale: CONSULTATION_LAPTOP.scale,
    laptopYaw: CONSULTATION_LAPTOP.rotation,
    typing: 0,
  };
}
