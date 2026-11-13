import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BENWA_HEIGHT,
  createRig,
  type BenwaRig,
} from "../apps/web/src/world/rig";
import { poseAt, type Pose } from "../apps/web/src/world/animations";

let source: THREE.Group;
beforeAll(async () => {
  const buf = fs.readFileSync("apps/web/public/models/benwa.glb");
  const gltf = await new GLTFLoader().parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    "",
  );
  source = gltf.scene;
});
const fresh = (): BenwaRig => createRig(source.clone(true));
const rest: Pose = {
  ...poseAt("idle", 0),
  squash: 0,
  leafSway: 0,
  tilt: 0,
  bob: 0,
};
const worldOf = (rig: BenwaRig, pattern: RegExp) => {
  rig.object.updateMatrixWorld(true);
  let found: THREE.Object3D | undefined;
  rig.object.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && pattern.test(o.name)) found = o;
  });
  if (!found) throw new Error(`no mesh ${pattern}`);
  const box = new THREE.Box3().setFromObject(found);
  return box.getCenter(new THREE.Vector3());
};

describe("Benwa rig", () => {
  it("normalises size and orientation", () => {
    const rig = fresh();
    rig.apply(rest);
    rig.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.object);
    expect(box.max.y - box.min.y).toBeGreaterThan(BENWA_HEIGHT - 0.03);
    expect(box.max.y - box.min.y).toBeLessThan(BENWA_HEIGHT + 0.03);
    expect(Math.abs(box.min.y)).toBeLessThan(0.01);
    expect(worldOf(rig, /Left_black_pupil/).z).toBeGreaterThan(
      worldOf(rig, /Cream_bean_body/).z,
    );
  });
  it("has every limb pivot", () => {
    const rig = fresh();
    for (const name of [
      "legL",
      "legR",
      "armL",
      "armR",
      "leaves",
      "eyeL",
      "eyeR",
    ])
      expect(rig.object.getObjectByName(`pivot:${name}`), name).toBeDefined();
  });
  it("left leg swing moves only the left foot", () => {
    const rig = fresh();
    rig.apply(rest);
    const leftBefore = worldOf(rig, /Left_flat_foot/),
      rightBefore = worldOf(rig, /Right_flat_foot/);
    rig.apply({ ...rest, legL: 0.6 });
    expect(
      worldOf(rig, /Left_flat_foot/).distanceTo(leftBefore),
    ).toBeGreaterThan(0.02);
    expect(
      worldOf(rig, /Right_flat_foot/).distanceTo(rightBefore),
    ).toBeLessThan(1e-6);
  });
  it("forward arm swing moves the hand toward the camera", () => {
    const rig = fresh();
    rig.apply(rest);
    const before = worldOf(rig, /Right_mitten_hand/);
    rig.apply({ ...rest, armR: 1 });
    expect(worldOf(rig, /Right_mitten_hand/).z).toBeGreaterThan(
      before.z + 0.05,
    );
  });
  it("raising an arm lifts the hand", () => {
    const rig = fresh();
    rig.apply(rest);
    const before = worldOf(rig, /Left_mitten_hand/);
    rig.apply({ ...rest, armLRaise: 1.2 });
    expect(worldOf(rig, /Left_mitten_hand/).y).toBeGreaterThan(before.y + 0.05);
  });
  it("closing eyes scales eyes", () => {
    const rig = fresh();
    rig.apply({ ...rest, eyeOpen: 0.1 });
    const eye = rig.object.getObjectByName("pivot:eyeL")!;
    expect(eye.scale.z).toBeLessThanOrEqual(0.15);
  });
  it("headTop is above the model", () => {
    const rig = fresh();
    rig.apply(rest);
    expect(rig.headTop().y).toBeGreaterThan(BENWA_HEIGHT * 0.95);
  });
});
