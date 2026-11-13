// Root cause of the old "invisible Benwa" screenshots: not the model or its scale. The captures were taken
// without a rendered frame containing the model (animation frames throttled during capture). World.tsx
// therefore reports data-model-state="ready" only after the first frame has been drawn with this rig.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Pose } from "./animations";

export const BENWA_HEIGHT = 1.8;

export interface BenwaRig {
  /** Y-up, feet at y=0, centred on x/z, faces +Z at yaw 0. Position and yaw belong to the caller. */
  object: THREE.Group;
  apply(pose: Pose): void;
  headTop(): THREE.Vector3;
  dispose(): void;
}

type V3 = [number, number, number];
/** Joint positions in the source model's space (Z-up, face along +X, "Left" meshes at negative Y). */
const JOINTS: Record<string, { at: V3; meshes: RegExp }> = {
  legL: { at: [-0.185, -0.31, 0.646], meshes: /Left_leg|Left_flat_foot/ },
  legR: { at: [-0.185, 0.31, 0.646], meshes: /Right_leg|Right_flat_foot/ },
  armL: { at: [-0.24, -0.56, 1.5], meshes: /Left_curved_arm|Left_mitten_hand/ },
  armR: {
    at: [-0.24, 0.56, 1.5],
    meshes: /Right_curved_arm|Right_mitten_hand/,
  },
  leaves: { at: [0.395, 0, 2.66], meshes: /stem|leaf/i },
};
const EYES: Record<string, RegExp> = {
  eyeL: /Left_eyeball|Left_black_pupil/,
  eyeR: /Right_eyeball|Right_black_pupil/,
};

function meshesMatching(root: THREE.Object3D, pattern: RegExp) {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && pattern.test(o.name))
      found.push(o as THREE.Mesh);
  });
  return found;
}

/** Moves meshes under a pivot placed at `at`, keeping the rest pose unchanged. */
function pivotAt(
  model: THREE.Object3D,
  name: string,
  at: THREE.Vector3,
  meshes: THREE.Mesh[],
) {
  const pivot = new THREE.Group();
  pivot.name = `pivot:${name}`;
  pivot.position.copy(at);
  model.add(pivot);
  for (const mesh of meshes) {
    mesh.updateMatrix();
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.applyMatrix4(mesh.matrix);
    mesh.geometry.translate(-at.x, -at.y, -at.z);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    pivot.add(mesh);
  }
  return pivot;
}

export function createRig(source: THREE.Group): BenwaRig {
  source.updateMatrixWorld(true);
  // Flatten every mesh into one model-space group so joints are in source coordinates.
  const model = new THREE.Group();
  const all = meshesMatching(source, /./);
  for (const mesh of all) {
    mesh.updateWorldMatrix(true, false);
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
  }
  const pivots: Record<string, THREE.Group> = {};
  for (const [name, joint] of Object.entries(JOINTS))
    pivots[name] = pivotAt(
      model,
      name,
      new THREE.Vector3(...joint.at),
      meshesMatching(model, joint.meshes).filter((m) => m.parent === model),
    );
  for (const [name, pattern] of Object.entries(EYES)) {
    const meshes = meshesMatching(model, pattern);
    const eyeball = meshes.find((m) => /eyeball/.test(m.name)) ?? meshes[0];
    const centre = new THREE.Box3()
      .setFromObject(eyeball)
      .getCenter(new THREE.Vector3());
    pivots[name] = pivotAt(model, name, centre, meshes);
  }
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  model.position.set(-centre.x, -centre.y, -bounds.min.z);
  const head = new THREE.Object3D();
  head.position.set(centre.x, 0, bounds.max.z + 0.25);
  model.add(head);

  // Z-up/+X-forward → Y-up/+Z-forward, scaled to BENWA_HEIGHT.
  const upright = new THREE.Group();
  upright.rotation.x = -Math.PI / 2;
  upright.scale.setScalar(BENWA_HEIGHT / size.z);
  upright.add(model);
  const facing = new THREE.Group();
  facing.rotation.y = -Math.PI / 2;
  facing.add(upright);
  const body = new THREE.Group();
  body.add(facing);
  const object = new THREE.Group();
  object.name = "benwa";
  object.add(body);

  return {
    object,
    apply(pose) {
      pivots.legL.rotation.set(0, -pose.legL, 0);
      pivots.legR.rotation.set(0, -pose.legR, 0);
      pivots.armL.rotation.set(-pose.armLRaise, -pose.armL, 0);
      pivots.armR.rotation.set(pose.armRRaise, -pose.armR, 0);
      pivots.leaves.rotation.set(pose.leafSway, 0, 0);
      const eye = Math.max(0.1, Math.min(1, pose.eyeOpen));
      pivots.eyeL.scale.set(1, 1, eye);
      pivots.eyeR.scale.set(1, 1, eye);
      body.position.y = pose.bob * BENWA_HEIGHT;
      body.rotation.set(pose.lean, pose.turn, pose.tilt);
      body.scale.set(1 - pose.squash / 2, 1 + pose.squash, 1 - pose.squash / 2);
    },
    headTop() {
      return head.getWorldPosition(new THREE.Vector3());
    },
    dispose() {
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          m.dispose();
      });
      object.removeFromParent();
    },
  };
}

export async function loadRig(
  url: string,
  signal: AbortSignal,
): Promise<BenwaRig> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Model not found");
  const gltf = await new GLTFLoader().parseAsync(
    await response.arrayBuffer(),
    "",
  );
  return createRig(gltf.scene);
}
