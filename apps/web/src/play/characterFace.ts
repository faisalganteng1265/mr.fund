import { Mesh, type Object3D } from "three";
import { type SpeechCue, textViseme } from "./speechVisemes";

export type Expression = "listening" | "thinking" | "speaking" | "concerned" | "pleased";

/** Animate the artist-authored Rocketbox face; never modify its topology or add artificial lips. */
export function createCharacterFace(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh && object.morphTargetDictionary?.viseme_aa !== undefined)
      meshes.push(object);
  });
  if (!meshes.length) return null;
  const visemes = ["PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];
  const names = [
    ...visemes.map((name) => `viseme_${name}`),
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "mouthSmileLeft",
    "mouthSmileRight",
  ];
  // Cache bindings once rather than allocating dictionaries in the animation loop.
  const bindings = meshes.flatMap((mesh) =>
    names.flatMap((name) => {
      const index = mesh.morphTargetDictionary?.[name];
      return index === undefined ? [] : [{ mesh, index, name }];
    }),
  );
  let elapsed = 0,
    speechTime = 0,
    previousId = -1,
    boundary = -1,
    boundaryTime = 0;
  return {
    update(delta: number, expression: Expression, reduced: boolean, cue?: SpeechCue) {
      elapsed += delta;
      const speaking = expression === "speaking" && !reduced;
      if (!speaking || cue?.id !== previousId) {
        speechTime = 0;
        boundary = -1;
        previousId = cue?.id ?? -1;
      }
      if (speaking) speechTime += delta;
      if (cue?.charIndex !== null && cue?.charIndex !== undefined && cue.charIndex !== boundary) {
        boundary = cue.charIndex;
        boundaryTime = speechTime;
      }
      const index =
        boundary >= 0
          ? boundary + Math.floor((speechTime - boundaryTime) * 13)
          : Math.floor(speechTime * 18);
      const viseme = speaking && cue ? textViseme(cue.text, index) : "sil";
      // Short, restrained articulations leave complete closures for M/B/P and pauses.
      const phase = (speechTime * 7.2) % 1;
      const articulation = 0.35 + 0.65 * Math.sin(phase * Math.PI);
      const blinkPhase = elapsed % 4.7;
      const blink = reduced ? 0 : Math.max(0, 1 - Math.abs(blinkPhase - 4.48) / 0.105);
      const blend = reduced ? 1 : 1 - Math.exp(-delta * 19);
      for (const binding of bindings) {
        let value = 0;
        if (binding.name === `viseme_${viseme}` && viseme !== "sil")
          value = (viseme === "PP" ? 0.85 : 0.58) * articulation;
        else if (binding.name.startsWith("eyeBlink")) value = blink;
        else if (binding.name === "browInnerUp") value = expression === "thinking" ? 0.2 : 0;
        else if (binding.name.startsWith("browDown")) value = expression === "concerned" ? 0.32 : 0;
        else if (binding.name.startsWith("mouthSmile")) value = expression === "pleased" ? 0.3 : 0;
        const weights = binding.mesh.morphTargetInfluences;
        if (weights)
          weights[binding.index] =
            (weights[binding.index] ?? 0) + (value - (weights[binding.index] ?? 0)) * blend;
      }
    },
  };
}
