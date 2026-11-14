import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Load the actual embedded rig/geometry without decoding images in a Node test. */
export async function rocketboxAsset() {
  const source = readFileSync("apps/web/public/play/rocketbox/business-male-01.glb");
  const jsonLength = source.readUInt32LE(12);
  const data = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
  data.materials = data.materials.map(() => ({}));
  delete data.images;
  delete data.textures;
  const json = Buffer.from(JSON.stringify(data));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = source.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const glb = Buffer.concat([header, padded, binary]);
  return (
    await new GLTFLoader().parseAsync(
      glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
      "",
    )
  ).scene;
}
