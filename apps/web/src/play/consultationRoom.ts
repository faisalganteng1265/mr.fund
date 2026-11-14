import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import wordmarkTypeface from "./assets/wordmark.typeface.json";

/** A dark office built from lightweight geometry; no furniture downloads or image textures. */
export function createConsultationRoom() {
  const room = new THREE.Group();
  const material = (color: string, roughness = 0.85, glow?: string) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness,
      ...(glow ? { emissive: glow, emissiveIntensity: 0.55 } : {}),
    });
  const wall = material("#171e20"),
    wood = material("#352e28"),
    trim = material("#303b3d"),
    brass = material("#9b8563", 0.4),
    dark = material("#101617");
  const box = (
    w: number,
    h: number,
    d: number,
    surface: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const object = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(0.025, h / 3, d / 3)),
      surface,
    );
    object.position.set(x, y, z);
    object.receiveShadow = true;
    room.add(object);
    return object;
  };
  box(13, 0.12, 13, wood, 0, -0.07, 1);
  for (let i = 0; i < 19; i++) box(0.012, 0.005, 12, dark, -6 + i * 0.65, -0.005, 1);
  box(13, 6, 0.2, wall, 0, 3, -3.2);
  box(0.2, 6, 12, wall, -6, 3, 1);
  box(0.2, 6, 12, wall, 6, 3, 1);
  box(12, 0.12, 0.13, trim, 0, 0.07, -3.05);
  box(0.13, 0.12, 12, trim, -5.85, 0.07, 1);
  // Architectural wall battens, deliberately restrained so the actor remains the focus.
  for (let i = 0; i < 8; i++) box(0.055, 4.6, 0.055, trim, 1.7 + i * 0.42, 2.4, -3.06);
  const glass = material("#142c39", 0.4, "#1c3542");
  box(3.2, 3.2, 0.08, trim, -3.6, 3, -3.02);
  box(3.02, 3.02, 0.04, glass, -3.6, 3, -2.96);
  const city = material("#0b141a");
  for (let i = 0; i < 7; i++)
    box(0.32, 0.65 + (i % 3) * 0.23, 0.03, city, -4.86 + i * 0.42, 1.9, -2.92);
  for (const x of [-4.66, -4.08, -3.15, -2.49])
    box(0.05, 0.055, 0.015, material("#9c8e6e", 0.7, "#9c8e6e"), x, 2.05, -2.89);
  box(0.055, 3.1, 0.08, trim, -3.6, 3, -2.85);
  box(3.1, 0.055, 0.08, trim, -3.6, 3.15, -2.85);
  // The letters themselves touch the left wall; there is deliberately no sign/backplate.
  const lettering = new TextGeometry("mr.fund", {
    font: new FontLoader().parse(wordmarkTypeface),
    size: 0.55,
    depth: 0.065,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 2,
  });
  lettering.computeBoundingBox();
  if (lettering.boundingBox) {
    const bounds = lettering.boundingBox;
    lettering.translate(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, 0);
    const scale = 3.2 / (bounds.max.x - bounds.min.x);
    lettering.scale(scale, scale, scale);
  }
  const wordmark = new THREE.Mesh(lettering, [material("#dbceb4", 0.5), material("#8c7c63", 0.6)]);
  wordmark.name = "mr-fund-wall-wordmark";
  wordmark.rotation.y = Math.PI / 2;
  wordmark.position.set(-5.889, 4.05, -0.45);
  wordmark.castShadow = true;
  wordmark.receiveShadow = true;
  room.add(wordmark);
  // Low bookcase and a framed geometric print behind the workstation.
  box(2.05, 1.6, 0.48, wood, 3.65, 0.8, -2.65);
  for (const y of [0.15, 0.8, 1.45]) box(2.1, 0.07, 0.52, brass, 3.65, y, -2.63);
  const books = ["#52615c", "#7c715f", "#333e49", "#797c71"].map((color) => material(color));
  for (let i = 0; i < 10; i++)
    box(
      0.12,
      0.37 + (i % 3) * 0.07,
      0.28,
      books[i % books.length] ?? wood,
      2.84 + i * 0.17,
      1.1,
      -2.48,
    );
  box(1.75, 1.7, 0.1, brass, 0.1, 3.1, -3.02);
  box(1.6, 1.55, 0.04, material("#283337"), 0.1, 3.1, -2.95);
  for (let i = 0; i < 4; i++)
    box(0.14, 0.25 + i * 0.2, 0.025, material("#62746a"), -0.4 + i * 0.32, 2.8 + i * 0.1, -2.91);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 0.42, 24), dark);
  pot.position.set(-4.9, 0.21, -1.1);
  room.add(pot);
  const leafMaterial = material("#344d3f");
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), leafMaterial);
    leaf.position.set(
      -4.9 + Math.sin(i * 2.4) * 0.2,
      0.62 + i * 0.12,
      -1.1 + Math.cos(i * 2.4) * 0.16,
    );
    leaf.scale.set(0.45, 1.6, 0.45);
    leaf.rotation.z = Math.sin(i * 2.4) * 0.55;
    room.add(leaf);
  }
  // A warm practical light balances the cool night window.
  box(0.12, 1.65, 0.12, brass, 2.2, 0.85, -1.4);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.4, 32, 1, true), material("#4a4438"));
  shade.position.set(2.2, 1.9, -1.4);
  room.add(shade);
  const lamp = new THREE.PointLight(0xffd6a1, 5, 5, 2);
  lamp.position.set(2.2, 1.68, -1.4);
  room.add(lamp);
  return room;
}
