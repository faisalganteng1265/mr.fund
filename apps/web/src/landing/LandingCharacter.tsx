"use client";

import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCharacterFace } from "../play/characterFace";
import { mobileConsultation } from "../play/mobileConsultation";
import { createRealisticCharacterMotion } from "../play/realisticCharacter";
import type { SpeechCue } from "../play/speechVisemes";
import { Mascot } from "./Mascot";

type Props = {
  active: boolean;
  standing?: boolean;
  speaking: boolean;
  thinking: boolean;
  cue: { current: SpeechCue };
  wave: number;
};
function Character(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const standing = live.current.standing ?? false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !standing,
        powerPreference: "low-power",
      });
    } catch {
      setStatus("fallback");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, standing ? 1.15 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setClearColor(0, 0);
    renderer.domElement.className = "block size-full";
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.45;
    scene.add(new THREE.HemisphereLight(0xfff8ee, 0x53665a, 2));
    const key = new THREE.DirectionalLight(0xfff0da, 3.6);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 2.2);
    rim.position.set(4, 3, -2);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    let dirty = true,
      disposed = false;
    let actor: THREE.Object3D | null = null;
    let actorCenter = 0;
    const furniture = new THREE.Group();
    furniture.visible = !standing;
    scene.add(furniture);
    const resize = () => {
      const width = Math.max(1, el.clientWidth),
        height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.set(0.35, 2.3, 4.6 * Math.max(1, 0.78 / camera.aspect));
      camera.lookAt(0, 1.95, 0);
      if (standing) {
        const framing = mobileConsultation(1, camera.aspect);
        camera.position.set(...framing.camera);
        camera.lookAt(new THREE.Vector3(...framing.target));
        if (actor) actor.position.x = actorCenter + framing.actor.x;
      }
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const deskMaterial = new THREE.MeshStandardMaterial({ color: "#34443b", roughness: 0.9 });
    const laptopMaterial = new THREE.MeshStandardMaterial({ color: "#171e1c", roughness: 0.55 });
    const box = (
      w: number,
      h: number,
      d: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      object.position.set(x, y, z);
      furniture.add(object);
      return object;
    };
    box(3.8, 0.1, 1, deskMaterial, 0, 1.24, 0.95);
    box(3.8, 0.3, 0.08, deskMaterial, 0, 1.05, 1.4);
    box(0.65, 0.035, 0.42, laptopMaterial, -0.85, 1.32, 0.95);
    const screen = box(0.65, 0.4, 0.035, laptopMaterial, -0.85, 1.51, 1.15);
    screen.rotation.x = -0.12;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.035, 0.007, 8, 24),
      new THREE.MeshStandardMaterial({ color: "#d3e5d7" }),
    );
    ring.position.set(-0.85, 1.51, 1.174);
    furniture.add(ring);
    let motion: ReturnType<typeof createRealisticCharacterMotion> = null;
    let face: ReturnType<typeof createCharacterFace> = null;
    const release = (root: THREE.Object3D) => {
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>(),
        textures = new Set<THREE.Texture>(),
        skeletons = new Set<THREE.Skeleton>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      for (const item of textures) item.dispose();
      for (const item of skeletons) item.dispose();
    };
    new GLTFLoader().load(
      "/play/rocketbox/business-male-01.glb",
      ({ scene: model }) => {
        if (disposed) {
          release(model);
          return;
        }
        motion = createRealisticCharacterMotion(model, -0.55);
        face = createCharacterFace(model);
        if (!motion || !face) {
          release(model);
          setStatus("fallback");
          return;
        }
        const bounds = new THREE.Box3().setFromObject(model, true);
        const scale = 3.9 / (bounds.max.y - bounds.min.y);
        model.scale.setScalar(scale);
        model.position.set((-(bounds.max.x + bounds.min.x) * scale) / 2, -bounds.min.y * scale, 0);
        model.updateMatrixWorld(true);
        const hips = model.getObjectByName("Hips");
        if (hips && !standing)
          model.position.y -= hips.getWorldPosition(new THREE.Vector3()).y - 1.05;
        actor = model;
        actorCenter = model.position.x;
        resize();
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.frustumCulled = false;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (material instanceof THREE.MeshStandardMaterial && material.transparent) {
              material.alphaTest = 0.35;
              material.depthWrite = true;
            }
        });
        scene.add(model);
        dirty = true;
        setStatus("ready");
      },
      undefined,
      () => {
        if (!disposed) setStatus("fallback");
      },
    );
    let frame = 0,
      previous = 0,
      lastDraw = 0,
      wasActive = true;
    const render = (time: number) => {
      frame = requestAnimationFrame(render);
      const current = live.current;
      const active = current.active && !document.hidden;
      if (!active && !wasActive && !dirty) return;
      const interval = 1000 / (standing ? 24 : 40);
      if (active && !dirty && time - lastDraw < interval) return;
      lastDraw = time - ((time - lastDraw) % interval);
      const delta = Math.min(0.05, Math.max(0, (time - previous) / 1000));
      previous = time;
      wasActive = active;
      dirty = false;
      motion?.update(delta, current.wave, !active, current.thinking ? "thinking" : "calm", 0, {
        walk: 0,
        stride: 0,
        reach: 0,
        sit: standing ? 0 : 1,
      });
      face?.update(
        delta,
        current.speaking && active ? "speaking" : current.thinking ? "thinking" : "listening",
        !active,
        current.cue.current,
      );
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      release(scene);
      environment.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      ref={host}
      role="img"
      aria-label={
        props.standing
          ? "Live standing Mr.Fund in a scripted chat"
          : "Mr.Fund at his desk, speaking through a scripted demonstration"
      }
      className="absolute inset-0"
    >
      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center">
          <Mascot size={300} className="w-[65%] max-w-[300px]" />
          {status === "fallback" && (
            <span className="absolute bottom-8 text-sm text-[#203327]">
              Illustrated preview · 3D unavailable
            </span>
          )}
        </div>
      )}
    </div>
  );
}
export const LandingCharacter = memo(Character);
