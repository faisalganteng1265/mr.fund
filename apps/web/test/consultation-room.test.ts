import { Box3, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createConsultationRoom } from "../src/play/consultationRoom";

it("places actual extruded lettering on the inner left wall", () => {
  const room = createConsultationRoom();
  const wordmark = room.getObjectByName("mr-fund-wall-wordmark");
  expect(wordmark).toBeInstanceOf(Mesh);
  if (!(wordmark instanceof Mesh)) throw new Error("Missing wall lettering");
  room.updateMatrixWorld(true);
  const size = new Box3().setFromObject(wordmark).getSize(new Vector3());
  expect(wordmark.position.x).toBeLessThan(-5.8);
  expect(wordmark.rotation.y).toBeCloseTo(Math.PI / 2);
  expect(size.x).toBeGreaterThan(0.04);
  expect(size.z).toBeCloseTo(3.2, 1);
  expect(size.y).toBeGreaterThan(0.3);
  expect(wordmark.castShadow).toBe(true);
});

describe("dark office geometry", () => {
  it("does not require external textures or downloaded furniture", () => {
    const room = createConsultationRoom();
    let meshes = 0;
    room.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      meshes++;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) expect("map" in material ? material.map : null).toBeNull();
    });
    expect(meshes).toBeGreaterThan(20);
  });
});
