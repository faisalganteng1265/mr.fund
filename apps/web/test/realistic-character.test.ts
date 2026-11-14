import { readFileSync } from "node:fs";
import { Bone, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  CONSULTATION_DESK as DESK,
  CONSULTATION_LAPTOP as LAPTOP,
} from "../src/play/consultationScene";
import { createRealisticCharacterMotion } from "../src/play/realisticCharacter";

type Node = {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};
function downloadedRig() {
  const binary = readFileSync("apps/web/public/play/jungle-jim/businessman.glb");
  const data = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)).toString()) as {
    nodes: Node[];
    skins: { joints: number[] }[];
    scenes: { nodes: number[] }[];
  };
  const joints = new Set(data.skins.flatMap((skin) => skin.joints));
  const objects = data.nodes.map((node, index) => {
    const object = joints.has(index) ? new Bone() : new Object3D();
    object.name = node.name ?? "";
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  data.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      const object = objects[child];
      if (object) objects[index]?.add(object);
    }
  });
  const root = new Object3D();
  for (const index of data.scenes[0]?.nodes ?? []) {
    const object = objects[index];
    if (object) root.add(object);
  }
  root.updateMatrixWorld(true);
  return root;
}

describe("downloaded Jungle Jim rig", () => {
  it("stands with both arms naturally down instead of the source T-pose", () => {
    const root = downloadedRig();
    expect(createRealisticCharacterMotion(root)).not.toBeNull();
    root.updateMatrixWorld(true);
    for (const side of ["Left", "Right"]) {
      const arm = root.getObjectByName(`${side}Arm`);
      const elbow = root.getObjectByName(`${side}ForeArm`);
      expect(arm).toBeTruthy();
      expect(elbow).toBeTruthy();
      if (!arm || !elbow) throw new Error("Missing downloaded arm rig");
      const direction = elbow
        .getWorldPosition(new Vector3())
        .sub(arm.getWorldPosition(new Vector3()))
        .normalize();
      expect(direction.y).toBeLessThan(-0.95);
    }
  });
  it("waves through the real skeleton and restores standing arms for reduced motion", () => {
    const root = downloadedRig();
    const motion = createRealisticCharacterMotion(root);
    const arm = root.getObjectByName("RightArm");
    if (!motion || !arm) throw new Error("Missing motion rig");
    const standing = arm.quaternion.clone();
    for (let i = 0; i < 20; i++) motion.update(0.05, 1, false);
    expect(arm.quaternion.angleTo(standing)).toBeGreaterThan(0.5);
    motion.update(0.05, 1, true);
    expect(arm.quaternion.angleTo(standing)).toBeLessThan(0.00001);
    expect(Number.isFinite(arm.quaternion.w)).toBe(true);
  });
  it("bends the actual hips and knees into a seated pose, also with reduced motion", () => {
    const root = downloadedRig();
    const motion = createRealisticCharacterMotion(root);
    if (!motion) throw new Error("Missing motion rig");
    motion.update(0.05, 0, true, "calm", 0, { walk: 0, stride: 0, reach: 0, sit: 1 });
    root.updateMatrixWorld(true);
    for (const side of ["Left", "Right"]) {
      const hip = root.getObjectByName(`${side}UpLeg`);
      const knee = root.getObjectByName(`${side}Leg`);
      const foot = root.getObjectByName(`${side}Foot`);
      if (!hip || !knee || !foot) throw new Error("Missing seated leg rig");
      const thigh = knee
        .getWorldPosition(new Vector3())
        .sub(hip.getWorldPosition(new Vector3()))
        .normalize();
      const calf = foot
        .getWorldPosition(new Vector3())
        .sub(knee.getWorldPosition(new Vector3()))
        .normalize();
      expect(thigh.z).toBeGreaterThan(0.95);
      expect(calf.y).toBeLessThan(-0.95);
      expect(Number.isFinite(foot.getWorldPosition(new Vector3()).y)).toBe(true);
    }
    motion.update(0.05, 0, true, "calm", 0, { walk: 0, stride: 0, reach: 0, sit: 0 });
    root.updateMatrixWorld(true);
    const hip = root.getObjectByName("LeftUpLeg");
    const knee = root.getObjectByName("LeftLeg");
    if (!hip || !knee) throw new Error("Missing standing leg rig");
    expect(
      knee.getWorldPosition(new Vector3()).sub(hip.getWorldPosition(new Vector3())).normalize().y,
    ).toBeLessThan(-0.95);
  });
  it("keeps seated fingers above the desk and clear of the laptop footprint", () => {
    const root = downloadedRig();
    const motion = createRealisticCharacterMotion(root);
    if (!motion) throw new Error("Missing character rig");
    // Original geometry bounds from this downloaded asset, normalized to the portrait's 3.9 units.
    root.scale.setScalar(3.9 / (1.722135066986084 - 0.022224653512239456));
    root.position.y = -0.022224653512239456 * root.scale.y;
    root.updateMatrixWorld(true);
    const hip = root.getObjectByName("Hips");
    if (!hip) throw new Error("Missing hip");
    root.position.y -= hip.getWorldPosition(new Vector3()).y - 1.05;
    for (let frame = 0; frame < 80; frame++) {
      motion.update(0.05, 0, false, "calm", 0, { walk: 0, stride: 0, reach: 0, sit: 1 });
      root.updateMatrixWorld(true);
      for (const side of ["Left", "Right"]) {
        for (const digit of ["Index", "Middle", "Ring", "Pinky"]) {
          const finger = root.getObjectByName(`${side}Hand${digit}4`);
          if (!finger) throw new Error("Missing finger");
          const position = finger.getWorldPosition(new Vector3());
          expect(position.y).toBeGreaterThan(DESK.top + 0.015);
          expect(position.z).toBeGreaterThan(DESK.back);
          // Include the screen/keyboard width, rotation and a cuff/skin margin.
          const laptopRight =
            LAPTOP.x + LAPTOP.scale * (0.82 / 2 + (0.53 / 2) * Math.abs(Math.sin(LAPTOP.rotation)));
          expect(position.x - 0.03).toBeGreaterThan(laptopRight);
        }
      }
    }
  });
  it("types over the laptop without putting fingertips through the keyboard", () => {
    const root = downloadedRig();
    const motion = createRealisticCharacterMotion(root);
    if (!motion) throw new Error("Missing character rig");
    root.scale.setScalar(3.9 / (1.722135066986084 - 0.022224653512239456));
    root.position.y = -0.022224653512239456 * root.scale.y;
    root.updateMatrixWorld(true);
    const hip = root.getObjectByName("Hips");
    if (!hip) throw new Error("Missing hip");
    root.position.y -= hip.getWorldPosition(new Vector3()).y - 1.05;
    for (let frame = 0; frame < 80; frame++) {
      motion.update(0.05, 0, false, "calm", 0, { walk: 0, stride: 0, reach: 0, sit: 1 }, 1);
      root.updateMatrixWorld(true);
      for (const side of ["Left", "Right"]) {
        for (const digit of ["Index", "Middle", "Ring", "Pinky"]) {
          const finger = root.getObjectByName(`${side}Hand${digit}4`);
          if (!finger) throw new Error("Missing finger");
          const position = finger.getWorldPosition(new Vector3());
          expect(position.y).toBeGreaterThan(DESK.top + 0.05);
          expect(Math.abs(position.x)).toBeLessThan(0.36);
          expect(position.z).toBeGreaterThan(0.6);
          expect(position.z).toBeLessThan(1.25);
        }
      }
    }
  });
  it("swings walking hands forward and back, opposite to each other and their matching leg", () => {
    const root = downloadedRig();
    const motion = createRealisticCharacterMotion(root);
    if (!motion) throw new Error("Missing motion rig");
    const sample = (stride: number) => {
      motion.update(0, 0, false, "calm", 0, { walk: 1, stride, reach: 0 });
      root.updateMatrixWorld(true);
      const position = (name: string) => {
        const bone = root.getObjectByName(name);
        if (!bone) throw new Error(`Missing ${name}`);
        return root.worldToLocal(bone.getWorldPosition(new Vector3()));
      };
      return {
        left: position("LeftHand"),
        right: position("RightHand"),
        knee: position("LeftLeg"),
      };
    };
    for (const heading of [0, Math.PI / 2]) {
      root.rotation.y = heading;
      const a = sample(Math.PI / 2),
        b = sample(-Math.PI / 2);
      const left = a.left.sub(b.left),
        right = a.right.sub(b.right),
        knee = a.knee.sub(b.knee);
      for (const swing of [left, right]) {
        expect(Math.abs(swing.z)).toBeGreaterThan(0.1);
        expect(Math.abs(swing.z)).toBeGreaterThan(Math.abs(swing.x) * 5);
      }
      expect(left.z * right.z).toBeLessThan(0);
      expect(left.z * knee.z).toBeLessThan(0);
    }
  });
});
