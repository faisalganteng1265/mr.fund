"use client";

import Image from "next/image";
import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCharacterFace } from "./characterFace";
import { consultationEntrance, ENTRANCE_SECONDS } from "./consultationEntrance";
import { createConsultationRoom } from "./consultationRoom";
import { CONSULTATION_DESK as DESK, CONSULTATION_LAPTOP as LAPTOP } from "./consultationScene";
import { mobileConsultation } from "./mobileConsultation";
import { createPortraitResolution } from "./portraitResolution";
import { createRealisticCharacterMotion } from "./realisticCharacter";
import type { SpeechCue } from "./speechVisemes";

type Props = {
  mood: string;
  speaking: boolean;
  mobile: boolean;
  speech: { current: SpeechCue };
  wave: number;
  station: "office" | "chat";
  onEntranceComplete: () => void;
};

/** A bounded, seated character portrait. The desk and laptop are lightweight scene geometry; no room or furniture GLBs are loaded. */
function PortraitScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  useEffect(() => {
    if (status === "fallback" && props.station === "chat") props.onEntranceComplete();
  }, [status, props.station, props.onEntranceComplete]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setStatus("fallback");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "block h-full w-full";
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const officeBackground = new THREE.Color("#101416");
    scene.background = officeBackground;
    const room = createConsultationRoom();
    scene.add(room);
    const furniture = new THREE.Group();
    scene.add(furniture);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.4;
    scene.add(new THREE.HemisphereLight(0xeaf0ff, 0x454050, 1.4));
    const key = new THREE.DirectionalLight(0xfff1e2, 2.8);
    key.position.set(-3, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -4, far: 25 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd5e4db, 1.7);
    rim.position.set(3, 3, -2);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xb8d2ff, 0.8);
    fill.position.set(3, 2, 4);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
    const initial = consultationEntrance(0, 1);
    const target = new THREE.Vector3(...initial.target);
    camera.position.set(...initial.camera);
    camera.lookAt(target);
    const material = (color: string, roughness = 0.6, metalness = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const desk = material("#423a32", 0.8);
    const trim = material("#8b7c66", 0.45, 0.2);
    const metal = material("#262c2d", 0.4, 0.4);
    const chair = material("#282a29", 0.9);
    const cream = material("#d6c4a4", 0.7);
    const box = (
      w: number,
      h: number,
      d: number,
      surface: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = furniture,
    ) => {
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(w, h, d, 3, Math.min(0.05, h / 3, d / 3)),
        surface,
      );
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // A restrained desk silhouette grounds the seated character without bringing back the room.
    box(DESK.width, 0.12, DESK.depth, desk, 0, DESK.top - 0.085, DESK.back + DESK.depth / 2);
    box(DESK.width, 0.025, DESK.depth, trim, 0, DESK.top - 0.0125, DESK.back + DESK.depth / 2);
    box(2.4, 0.58, 0.08, desk, 0, 0.9, 1.35);
    for (const x of [-1.15, 1.15]) box(0.09, 1.3, 0.65, metal, x, 0.65, 0.95);
    box(0.85, 1.15, 0.13, chair, 0, 1.65, -0.4);
    box(0.85, 0.12, 0.75, chair, 0, 1.02, -0.03);
    for (const x of [-0.49, 0.49]) box(0.11, 0.09, 0.6, chair, x, 1.275, 0.05);
    const laptop = new THREE.Group();
    laptop.position.set(LAPTOP.x, DESK.top + 0.018, LAPTOP.z);
    laptop.scale.setScalar(LAPTOP.scale);
    laptop.rotation.y = LAPTOP.rotation;
    furniture.add(laptop);
    box(0.82, 0.035, 0.53, metal, 0, 0, -0.12, laptop);
    const display = new THREE.Group();
    display.position.set(0, 0.24, 0.12);
    display.rotation.x = -0.15;
    laptop.add(display);
    box(0.8, 0.48, 0.035, metal, 0, 0, 0, display);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.39), material("#8da298", 0.35));
    screen.position.z = -0.019;
    screen.rotation.y = Math.PI;
    display.add(screen);
    const logo = new THREE.Mesh(
      new THREE.TorusGeometry(0.043, 0.009, 8, 28),
      material("#d2e0d5", 0.4),
    );
    logo.position.z = 0.02;
    display.add(logo);
    box(0.62, 0.006, 0.28, chair, 0, 0.022, -0.16, laptop);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.22, 32), cream);
    mug.position.set(0.85, DESK.top + 0.11, 0.95);
    furniture.add(mug);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.018, 8, 20), cream);
    handle.position.set(0.95, DESK.top + 0.12, 0.95);
    furniture.add(handle);
    let actor: THREE.Object3D | null = null;
    let baseY = 0,
      centerX = 0,
      seatedDrop = 0;
    let motion: ReturnType<typeof createRealisticCharacterMotion> = null;
    let face: ReturnType<typeof createCharacterFace> = null;
    const disposeModel = (root: THREE.Object3D) => {
      const textures = new Set<THREE.Texture>();
      const materials = new Set<THREE.Material>();
      const geometries = new Set<THREE.BufferGeometry>();
      const skeletons = new Set<THREE.Skeleton>();
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
      for (const value of textures) value.dispose();
      for (const value of materials) value.dispose();
      for (const value of geometries) value.dispose();
      for (const value of skeletons) value.dispose();
    };
    new GLTFLoader().load(
      "/play/rocketbox/business-male-01.glb",
      ({ scene: model }) => {
        if (disposed) {
          disposeModel(model);
          return;
        }
        try {
          motion = createRealisticCharacterMotion(model, -0.55);
          if (!motion) throw new Error("Missing character rig");
          face = createCharacterFace(model);
          model.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(model, true);
          const scale = 3.9 / (bounds.max.y - bounds.min.y);
          model.scale.setScalar(scale);
          model.position.set(
            (-(bounds.max.x + bounds.min.x) * scale) / 2,
            -bounds.min.y * scale,
            0,
          );
          scene.add(model);
          model.updateMatrixWorld(true);
          const hips = model.getObjectByName("Hips");
          baseY = model.position.y;
          centerX = model.position.x;
          if (hips) seatedDrop = Math.max(0, hips.getWorldPosition(new THREE.Vector3()).y - 1.05);
          actor = model;
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.frustumCulled = false;
            object.castShadow = true;
            object.receiveShadow = true;
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              if (material instanceof THREE.MeshStandardMaterial && material.transparent) {
                material.alphaTest = 0.35;
                material.depthWrite = true;
              }
            }
          });
          setStatus("ready");
        } catch {
          scene.remove(model);
          disposeModel(model);
          motion = null;
          face = null;
          setStatus("fallback");
        }
      },
      undefined,
      () => {
        if (!disposed) setStatus("fallback");
      },
    );
    let width = 1,
      height = 1;
    const resolution = createPortraitResolution((nextWidth, nextHeight) =>
      renderer.setSize(nextWidth, nextHeight, false),
    );
    const resize = new ResizeObserver(() => {
      width = Math.max(1, element.clientWidth);
      height = Math.max(1, element.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      resolution.resize(width, height, performance.now());
    });
    resize.observe(element);
    let visible = true;
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    intersection.observe(element);
    let pointer = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch")
        pointer = ((event.clientX - element.getBoundingClientRect().left) / width - 0.5) * 2;
    };
    const onLeave = () => {
      pointer = 0;
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      previous = 0;
    let progress = 0,
      completed = false,
      completedAt = 0;
    const render = (time: number) => {
      frame = requestAnimationFrame(render);
      const delta = Math.min(0.05, Math.max(0, (time - previous) / 1000));
      previous = time;
      if (!visible || document.hidden) return;
      const current = live.current;
      const standing = current.mobile && current.station === "chat";
      room.visible = !standing;
      furniture.visible = !standing;
      scene.background = standing ? null : officeBackground;
      if (current.station === "office") {
        progress = 0;
        completed = false;
      } else if (motion)
        progress = reduced.matches
          ? 1
          : Math.min(1, progress + delta / (standing ? 1.1 : ENTRANCE_SECONDS));
      const entrance = standing
        ? mobileConsultation(progress, camera.aspect)
        : consultationEntrance(progress, camera.aspect);
      const interactive = standing || entrance.actor.sit >= 0.99;
      // Follow the one eased timeline directly; a second camera lerp causes a trailing stop.
      camera.position.set(...entrance.camera);
      target.set(...entrance.target);
      camera.lookAt(target);
      laptop.position.x = entrance.laptopX;
      laptop.rotation.y = entrance.laptopYaw;
      laptop.scale.setScalar(entrance.laptopScale);
      motion?.update(
        delta,
        interactive ? current.wave : 0,
        reduced.matches,
        current.mood,
        interactive ? pointer : 0,
        {
          walk: entrance.actor.walk,
          stride: entrance.actor.stride,
          reach: 0,
          sit: entrance.actor.sit,
        },
        entrance.typing,
      );
      if (actor) {
        actor.position.set(
          centerX + entrance.actor.x,
          baseY -
            seatedDrop * entrance.actor.sit +
            (reduced.matches
              ? 0
              : Math.abs(Math.sin(entrance.actor.stride)) * 0.018 * entrance.actor.walk),
          entrance.actor.z,
        );
        actor.rotation.y = entrance.actor.yaw;
      }
      if (progress === 1 && !completed) {
        completed = true;
        completedAt = time;
        current.onEntranceComplete();
      }
      // Do not reallocate the GPU buffer during the orbit or either panel's unfold.
      resolution.tick(
        time,
        current.station === "office" ||
          reduced.matches ||
          (completed && time - completedAt >= 1000),
      );
      face?.update(
        delta,
        current.speaking
          ? "speaking"
          : current.mood === "thinking"
            ? "thinking"
            : current.mood === "concerned"
              ? "concerned"
              : current.mood === "pleased"
                ? "pleased"
                : "listening",
        reduced.matches,
        current.speech.current,
      );
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      disposeModel(scene);
      key.shadow.dispose();
      environment.dispose();
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
        props.station === "office"
          ? "Mr.Fund standing in his dark office"
          : props.mobile
            ? "Mr.Fund standing beside your conversation"
            : "Mr.Fund walking to his chair and sitting for the consultation"
      }
      className="absolute inset-0 isolate overflow-hidden"
    >
      {status === "loading" && (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center text-[10px] text-[#b5a7ce]"
        >
          Getting ready to talk…
        </div>
      )}
      {status === "fallback" && (
        <Image
          fill
          sizes="(min-width:1280px) 320px, 50vw"
          src="/play/rocketbox/preview.webp"
          alt="Mr.Fund character preview — 3D unavailable"
          className="object-cover object-top"
        />
      )}
    </div>
  );
}

export const CharacterPortrait = memo(PortraitScene);
