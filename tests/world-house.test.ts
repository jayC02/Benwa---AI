import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildHouse } from "../apps/web/src/world/house";
import { FLOOR_HEIGHT, HOUSE_DEPTH } from "../apps/web/src/world/layout";
import { ROOM_IDS } from "../apps/web/src/world/rooms";

const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

describe("house", () => {
  it("every room has a group with props", () => {
    const house = buildHouse();
    for (const id of ROOM_IDS) {
      const room = house.group.getObjectByName(`room:${id}`);
      expect(room, id).toBeDefined();
      expect(meshes(room!).length, id).toBeGreaterThanOrEqual(3);
    }
    house.dispose();
  });
  it("front is open", () => {
    const house = buildHouse();
    house.group.updateMatrixWorld(true);
    for (const mesh of meshes(house.group)) {
      const box = new THREE.Box3().setFromObject(mesh);
      const wide = box.max.x - box.min.x > 2 && box.max.y - box.min.y > 1;
      expect(wide && box.min.z > HOUSE_DEPTH / 2 - 0.05, mesh.name).toBe(false);
    }
    house.dispose();
  });
  it("stair tower spans every floor", () => {
    const house = buildHouse();
    house.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(
      house.group.getObjectByName("stairs")!,
    );
    expect(box.min.y).toBeLessThanOrEqual(0);
    expect(box.max.y).toBeGreaterThanOrEqual(2 * FLOOR_HEIGHT);
    house.dispose();
  });
  it("label anchors sit inside each room", () => {
    const house = buildHouse();
    for (const id of ROOM_IDS)
      expect(house.labelAnchor[id]).toBeInstanceOf(THREE.Vector3);
    house.dispose();
  });
  it("dispose frees geometry", () => {
    const spy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const house = buildHouse();
    const geometries = new Set(meshes(house.group).map((m) => m.geometry));
    house.dispose();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(geometries.size);
    spy.mockRestore();
  });
});
