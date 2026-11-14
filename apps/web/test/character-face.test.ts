import { readFileSync } from "node:fs";
import { Box3, Mesh, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createCharacterFace } from "../src/play/characterFace";
import { createRealisticCharacterMotion } from "../src/play/realisticCharacter";
import { textViseme } from "../src/play/speechVisemes";
import { rocketboxAsset } from "./character-asset";

describe("optimized Rocketbox character", () => {
  it("ships the authored speech shapes below the 3 MB asset budget without rewriting geometry", async () => {
    expect(readFileSync("apps/web/public/play/rocketbox/business-male-01.glb").length).toBeLessThan(
      3_000_000,
    );
    const root = await rocketboxAsset();
    const geometries: Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof Mesh) geometries.push(object);
    });
    const positions = geometries.map((mesh) =>
      mesh.geometry.getAttribute("position").array.slice(),
    );
    expect(createCharacterFace(root)).not.toBeNull();
    for (const [index, mesh] of geometries.entries()) {
      expect(mesh.geometry.getAttribute("position").array).toEqual(positions[index]);
      expect(mesh.morphTargetDictionary).toHaveProperty("viseme_PP");
      expect(mesh.morphTargetDictionary).toHaveProperty("viseme_aa");
      expect(mesh.morphTargetDictionary).toHaveProperty("eyeBlinkLeft");
    }
    expect(root.getObjectByName("MrFundMouthInterior")).toBeUndefined();
  });
  it("blends different native lip shapes and returns to neutral when speech stops", async () => {
    const root = await rocketboxAsset();
    const face = createCharacterFace(root);
    const weights = (name: string) => {
      let sum = 0;
      root.traverse((object) => {
        if (object instanceof Mesh)
          sum += object.morphTargetInfluences?.[object.morphTargetDictionary?.[name] ?? -1] ?? 0;
      });
      return sum;
    };
    for (let i = 0; i < 12; i++)
      face?.update(1 / 60, "speaking", false, { id: 1, text: "mmmmmmmmmm", charIndex: null });
    expect(weights("viseme_PP")).toBeGreaterThan(0.1);
    for (let i = 0; i < 12; i++)
      face?.update(1 / 60, "speaking", false, { id: 2, text: "aaaaaaaaaa", charIndex: null });
    expect(weights("viseme_aa")).toBeGreaterThan(0.1);
    face?.update(1, "listening", true);
    expect(weights("viseme_aa")).toBe(0);
    expect(weights("viseme_PP")).toBe(0);
    expect(createCharacterFace(new Object3D())).toBeNull();
  });
  it("keeps the actual seated hands above the desk and away from the laptop", async () => {
    const root = await rocketboxAsset();
    const motion = createRealisticCharacterMotion(root, -0.55);
    expect(motion).not.toBeNull();
    const bounds = new Box3().setFromObject(root, true);
    const scale = 3.9 / (bounds.max.y - bounds.min.y);
    root.scale.setScalar(scale);
    root.position.y = -bounds.min.y * scale;
    root.updateMatrixWorld(true);
    const hips = root.getObjectByName("Hips");
    if (!hips) throw new Error("Missing hips");
    root.position.y -= hips.getWorldPosition(new Vector3()).y - 1.05;
    motion?.update(0.05, 0, true, "calm", 0, { walk: 0, stride: 0, reach: 0, sit: 1 });
    root.updateMatrixWorld(true);
    for (const side of ["Left", "Right"]) {
      const finger = root.getObjectByName(`${side}HandMiddle3`);
      if (!finger) throw new Error("Missing fingertip");
      const position = finger.getWorldPosition(new Vector3());
      expect(position.y).toBeGreaterThan(1.31);
      expect(position.y).toBeLessThan(1.5);
      expect(position.z).toBeGreaterThan(0.45);
      expect(position.x - 0.03).toBeGreaterThan(-0.55);
    }
  });
  it("keeps closures and pauses in the text approximation", () => {
    expect(textViseme("money", 0)).toBe("PP");
    expect(textViseme("fund", 0)).toBe("FF");
    expect(textViseme("a o", 0)).toBe("aa");
    expect(textViseme("a o", 1)).toBe("sil");
    expect(textViseme("a o", 2)).toBe("O");
  });
});
