import * as THREE from "three";
import {
  FLOOR_HEIGHT,
  HOUSE_DEPTH,
  ROOM_EXTENTS,
  STAIR_MAX_X,
  STAIR_MIN_X,
  STAIR_X,
} from "./layout";
import { ROOM_IDS, ROOMS, type RoomId } from "./rooms";

export interface House {
  group: THREE.Group;
  /** Top-left corner of each room at the open front, for HTML labels. */
  labelAnchor: Record<RoomId, THREE.Vector3>;
  setRoomHighlight(room: RoomId | null): void;
  /** Called every frame for tiny ambient motion (blinking lights, candle flicker). */
  update(time: number): void;
  dispose(): void;
}

const BACK = -HOUSE_DEPTH / 2;
const WALL = 0.15;
const H = FLOOR_HEIGHT;

/** Builds the dollhouse: two floors of three rooms, an attic bedroom, a ladder tower; front wall left open. */
export function buildHouse(): House {
  const geometries = new Map<string, THREE.BufferGeometry>();
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const owned: THREE.Material[] = [];
  const material = (colour: string | number, emissive?: string | number) => {
    const key = `${colour}|${emissive ?? ""}`;
    let m = materials.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.92,
        flatShading: true,
        ...(emissive !== undefined ? { emissive, emissiveIntensity: 0.9 } : {}),
      });
      materials.set(key, m);
    }
    return m;
  };
  const geo = (key: string, make: () => THREE.BufferGeometry) => {
    let g = geometries.get(key);
    if (!g) {
      g = make();
      geometries.set(key, g);
    }
    return g;
  };
  const boxGeo = (w: number, h: number, d: number) =>
    geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cylGeo = (rt: number, rb: number, h: number, seg = 10) =>
    geo(
      `c${rt}|${rb}|${h}|${seg}`,
      () => new THREE.CylinderGeometry(rt, rb, h, seg),
    );
  const sphereGeo = (r: number) =>
    geo(`s${r}`, () => new THREE.SphereGeometry(r, 8, 6));

  function mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    name = "",
  ) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  /** Box by its min corner and size; easier to lay out rooms with. */
  const box = (
    parent: THREE.Object3D,
    x0: number,
    y0: number,
    z0: number,
    w: number,
    h: number,
    d: number,
    colour: string | number,
    name = "",
  ) =>
    mesh(
      parent,
      boxGeo(w, h, d),
      material(colour),
      x0 + w / 2,
      y0 + h / 2,
      z0 + d / 2,
      name,
    );

  const group = new THREE.Group();
  group.name = "house";
  const shell = new THREE.Group();
  shell.name = "shell";
  group.add(shell);

  // Ground and garden strip.
  box(shell, -9, -0.4, -2.6, 19.5, 0.4, 5.6, "#b9cfa6", "ground");
  box(shell, -9, -0.42, 2.2, 19.5, 0.05, 0.8, "#d9cbb0", "path");

  const highlightable: Partial<Record<RoomId, THREE.MeshStandardMaterial>> = {};
  const rooms: Record<RoomId, THREE.Group> = {} as Record<RoomId, THREE.Group>;
  for (const id of ROOM_IDS) {
    const e = ROOM_EXTENTS[id];
    const g = new THREE.Group();
    g.name = `room:${id}`;
    group.add(g);
    rooms[id] = g;
    const y0 = e.floor * H;
    const w = e.maxX - e.minX;
    // Floor tile with its own material so the current room can glow a little.
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ROOMS[id].colour).lerp(
        new THREE.Color("#f4ede2"),
        0.55,
      ),
      roughness: 0.95,
      flatShading: true,
      emissive: new THREE.Color(ROOMS[id].colour),
      emissiveIntensity: 0,
    });
    owned.push(floorMat);
    highlightable[id] = floorMat;
    mesh(
      g,
      boxGeo(w, 0.16, HOUSE_DEPTH),
      floorMat,
      e.minX + w / 2,
      y0 + 0.08,
      0,
      `floor:${id}`,
    );
    // Back wall in a soft tint of the room colour, plus a skirting board.
    box(
      g,
      e.minX,
      y0,
      BACK - WALL,
      w,
      H,
      WALL,
      new THREE.Color(ROOMS[id].colour)
        .lerp(new THREE.Color("#ffffff"), 0.6)
        .getStyle(),
      `wall:${id}`,
    );
    box(g, e.minX, y0 + 0.16, BACK, w, 0.12, 0.05, "#ffffff", "skirting");
    // Sign board at the top of the back wall (text comes from HTML labels).
    box(
      g,
      e.minX + w / 2 - 0.7,
      y0 + H - 0.75,
      BACK + 0.02,
      1.4,
      0.38,
      0.06,
      ROOMS[id].colour,
      `sign:${id}`,
    );
  }

  // Ceilings/slabs between floors and side walls with doorways (back part only, front 2.2 left open).
  for (const f of [1, 2])
    box(
      shell,
      -7.6,
      f * H - 0.02,
      -2.15,
      15.2,
      0.18,
      4.3,
      "#e9e1d4",
      `slab${f}`,
    );
  for (const f of [0, 1]) {
    const y0 = f * H;
    box(shell, -7.75, y0, -2.15, WALL, H, 4.3, "#efe6da", "outer-left");
    for (const x of [-2.5, 2.5, 7.5])
      box(shell, x - WALL / 2, y0, -2.15, WALL, H, 1.8, "#efe6da", "divider");
    for (const x of [-2.5, 2.5, 7.5])
      box(
        shell,
        x - WALL / 2,
        y0 + 2.3,
        -0.35,
        WALL,
        H - 2.3,
        2.35,
        "#efe6da",
        "lintel",
      );
  }
  // Attic bedroom shell and gable roof; the rest of the top is a little roof terrace.
  box(shell, -2.5 - WALL, 2 * H, -2.15, WALL, H, 4.3, "#efe6da", "attic-left");
  box(
    shell,
    7.5 - WALL / 2,
    2 * H,
    -2.15,
    WALL,
    H,
    1.8,
    "#efe6da",
    "attic-right",
  );
  box(
    shell,
    -2.65,
    3 * H - 0.02,
    -2.15,
    10.3,
    0.15,
    4.3,
    "#e9e1d4",
    "attic-ceiling",
  );
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-3.1, 0);
  roofShape.lineTo(8.1, 0);
  roofShape.lineTo(2.5, 1.55);
  roofShape.closePath();
  const roof = mesh(
    shell,
    geo(
      "roof",
      () =>
        new THREE.ExtrudeGeometry(roofShape, {
          depth: 4.6,
          bevelEnabled: false,
        }),
    ),
    material("#c9776a"),
    0,
    3 * H + 0.1,
    -2.3,
    "roof",
  );
  roof.receiveShadow = false;
  box(shell, -7.6, 2 * H + 0.16, 1.7, 5, 0.5, 0.08, "#d8c7b0", "terrace-rail");
  box(shell, -6.6, 2 * H + 0.16, -1.7, 0.7, 1.6, 0.7, "#b8857a", "chimney");
  mesh(
    shell,
    cylGeo(0.28, 0.22, 0.45),
    material("#d9ad91"),
    -4.2,
    2 * H + 0.4,
    -0.8,
    "pot",
  );
  mesh(
    shell,
    sphereGeo(0.42),
    material("#8da780"),
    -4.2,
    2 * H + 0.95,
    -0.8,
    "bush",
  );

  // Ladder tower on the right.
  const stairs = new THREE.Group();
  stairs.name = "stairs";
  group.add(stairs);
  box(
    stairs,
    STAIR_MIN_X,
    -0.02,
    -2.15,
    STAIR_MAX_X - STAIR_MIN_X,
    3 * H + 0.2,
    WALL,
    "#e2d6c6",
    "tower-back",
  );
  box(
    stairs,
    STAIR_MAX_X,
    -0.02,
    -2.15,
    WALL,
    3 * H + 0.2,
    4.3,
    "#e9dfd1",
    "tower-side",
  );
  for (const f of [0, 1, 2])
    box(
      stairs,
      STAIR_MIN_X,
      f * H,
      -2.15,
      STAIR_MAX_X - STAIR_MIN_X,
      0.16,
      4.3,
      "#d8ccbb",
      "tower-floor",
    );
  for (const dx of [-0.35, 0.35])
    box(
      stairs,
      STAIR_X + dx - 0.04,
      0,
      -1.75,
      0.08,
      3 * H,
      0.08,
      "#a07a5c",
      "rail",
    );
  for (let y = 0.35; y < 3 * H; y += 0.4)
    box(stairs, STAIR_X - 0.35, y, -1.74, 0.7, 0.06, 0.06, "#b48b6a", "rung");
  const towerRoof = new THREE.Shape();
  towerRoof.moveTo(STAIR_MIN_X - 0.2, 0);
  towerRoof.lineTo(STAIR_MAX_X + 0.35, 0);
  towerRoof.lineTo(STAIR_X, 0.9);
  towerRoof.closePath();
  mesh(
    stairs,
    geo(
      "towerRoof",
      () =>
        new THREE.ExtrudeGeometry(towerRoof, {
          depth: 4.6,
          bevelEnabled: false,
        }),
    ),
    material("#c9776a"),
    0,
    3 * H + 0.18,
    -2.3,
    "tower-roof",
  );

  // --- Props, rough on purpose. ---
  const blinkers: THREE.Mesh[] = [];
  {
    const g = rooms.hall;
    box(g, -7.7, 0.16, -1.6, 0.12, 2.1, 1.1, "#8a5a44", "front-door");
    mesh(
      g,
      sphereGeo(0.06),
      material("#e4c169"),
      -7.55,
      1.1,
      -1.2,
      "door-knob",
    );
    box(g, -3.9, 0.16, -1.2, 0.1, 1.0, 0.1, "#7d6a5a", "postbox-post");
    box(g, -4.15, 1.15, -1.45, 0.6, 0.55, 0.6, "#d9534f", "postbox");
    box(g, -6.6, 0.16, -1.9, 1.6, 0.45, 0.5, "#b48b6a", "bench");
    box(
      g,
      -6.2,
      1.6,
      BACK + 0.02,
      0.8,
      0.5,
      0.05,
      "#f6e7b0",
      "welcome-mat-sign",
    );
    box(g, -6.4, 0.17, -0.3, 1.4, 0.02, 1.0, "#c97b63", "doormat");
  }
  {
    const g = rooms.study;
    box(g, -0.7, 0.16, -1.9, 2.2, 0.9, 0.9, "#c6a184", "desk");
    box(g, 0.0, 1.06, -1.85, 0.8, 0.65, 0.65, "#d9d4c7", "computer");
    const screen = box(
      g,
      0.08,
      1.14,
      -1.19,
      0.64,
      0.46,
      0.02,
      "#4a6f8a",
      "screen",
    );
    screen.material = material("#4a6f8a", "#3d7db0");
    box(g, 0.0, 1.06, -1.1, 0.9, 0.05, 0.3, "#9aa7b4", "keyboard");
    mesh(
      g,
      cylGeo(0.09, 0.07, 0.18),
      material("#f3eee0"),
      1.2,
      1.15,
      -1.45,
      "mug",
    );
    box(g, -2.2, 1.6, BACK + 0.02, 1.2, 0.08, 0.4, "#b48b6a", "shelf");
    for (let i = 0; i < 4; i++)
      box(
        g,
        -2.1 + i * 0.25,
        1.68,
        -1.85,
        0.18,
        0.4,
        0.28,
        ["#d9534f", "#5b8db8", "#e4c169", "#7ba05b"][i],
        "file",
      );
  }
  {
    const g = rooms.workshop;
    box(g, 3.0, 0.16, -1.95, 2.0, 0.85, 0.9, "#a98970", "workbench");
    box(g, 5.6, 0.16, -1.9, 1.3, 1.6, 1.0, "#8fa3b0", "machine");
    const light = mesh(
      g,
      sphereGeo(0.12),
      material("#e05a4f", "#ff5a3c"),
      6.25,
      1.95,
      -1.4,
      "machine-light",
    );
    blinkers.push(light);
    for (let i = 0; i < 3; i++) {
      const gear = mesh(
        g,
        cylGeo(0.22, 0.22, 0.08, 8),
        material("#c9a24a"),
        5.9 + i * 0.32,
        1.1,
        -0.88,
        "gear",
      );
      gear.rotation.x = Math.PI / 2;
    }
    box(g, 3.2, 1.7, BACK + 0.02, 1.6, 0.9, 0.05, "#c7b299", "pegboard");
    box(g, 3.5, 1.2, -1.5, 0.5, 0.15, 0.2, "#d9534f", "toolbox");
  }
  {
    const g = rooms.library;
    const books = [
      "#d9534f",
      "#5b8db8",
      "#e4c169",
      "#7ba05b",
      "#a56fb8",
      "#e08a4f",
    ];
    for (const x0 of [-7.3, -6.0]) {
      box(g, x0, H + 0.16, -1.95, 1.2, 2.3, 0.55, "#8a5a44", "bookshelf");
      for (let shelf = 0; shelf < 4; shelf++)
        for (let i = 0; i < 5; i++)
          box(
            g,
            x0 + 0.08 + i * 0.22,
            H + 0.3 + shelf * 0.55,
            -1.75,
            0.16,
            0.42,
            0.32,
            books[(i + shelf) % books.length],
            "book",
          );
    }
    box(g, -3.9, H + 0.16, -1.6, 1.0, 0.5, 0.9, "#7d9c8a", "armchair");
    box(g, -3.9, H + 0.66, -1.95, 1.0, 0.7, 0.25, "#7d9c8a", "armchair-back");
    mesh(
      g,
      cylGeo(0.03, 0.03, 1.4),
      material("#6e6259"),
      -2.85,
      H + 0.86,
      -1.6,
      "lamp-pole",
    );
    mesh(
      g,
      cylGeo(0.15, 0.3, 0.35),
      material("#f3d9a0", "#f5c86a"),
      -2.85,
      H + 1.7,
      -1.6,
      "lamp-shade",
    );
  }
  {
    const g = rooms.planning;
    box(g, -1.6, H + 1.0, BACK + 0.02, 3.2, 1.6, 0.06, "#c49a6c", "corkboard");
    const notes = ["#f6e7b0", "#f2c4c0", "#c7e0f2", "#cfe8c3"];
    for (let i = 0; i < 6; i++)
      box(
        g,
        -1.4 + (i % 3) * 1.0,
        H + 1.2 + Math.floor(i / 3) * 0.7,
        BACK + 0.09,
        0.5,
        0.4,
        0.02,
        notes[i % notes.length],
        "note",
      );
    box(g, -1.2, H + 1.65, BACK + 0.11, 2.4, 0.03, 0.01, "#d9534f", "string");
    box(g, 0.8, H + 0.16, -1.3, 1.2, 0.7, 0.7, "#c6a184", "plan-table");
    box(g, 0.9, H + 0.86, -1.2, 0.5, 0.03, 0.4, "#ffffff", "plan-paper");
  }
  {
    const g = rooms.journal;
    box(g, 4.6, H + 0.16, -1.9, 1.5, 0.8, 0.8, "#b48b6a", "writing-desk");
    box(g, 4.95, H + 0.96, -1.55, 0.6, 0.05, 0.45, "#efe3c8", "notebook");
    mesh(
      g,
      cylGeo(0.06, 0.06, 0.25),
      material("#f3eee0"),
      5.9,
      H + 1.08,
      -1.6,
      "candle",
    );
    const flame = mesh(
      g,
      sphereGeo(0.06),
      material("#ffb347", "#ffa630"),
      5.9,
      H + 1.26,
      -1.6,
      "flame",
    );
    blinkers.push(flame);
    box(g, 3.2, H + 0.17, -1.2, 1.8, 0.02, 1.6, "#a56fb8", "rug");
    box(g, 3.0, H + 1.8, BACK + 0.02, 0.9, 0.7, 0.05, "#e9d8b8", "picture");
  }
  {
    const g = rooms.bedroom;
    const y = 2 * H;
    box(g, 2.6, y + 0.16, -1.95, 2.0, 0.35, 1.2, "#8a5a44", "bed-frame");
    box(g, 2.65, y + 0.5, -1.9, 1.9, 0.18, 1.1, "#f3eee0", "mattress");
    box(g, 2.75, y + 0.68, -1.85, 0.5, 0.15, 0.9, "#ffffff", "pillow");
    box(g, 3.3, y + 0.68, -1.92, 1.3, 0.1, 1.14, "#7fa6c9", "blanket");
    const pane = box(
      g,
      0.2,
      y + 1.2,
      BACK + 0.03,
      1.1,
      0.9,
      0.04,
      "#cfe3f2",
      "window",
    );
    pane.material = material("#cfe3f2", "#9fc3e0");
    box(g, 5.0, y + 0.16, -1.8, 0.5, 0.55, 0.5, "#b48b6a", "nightstand");
    mesh(
      g,
      sphereGeo(0.15),
      material("#f3d9a0", "#f5c86a"),
      5.25,
      y + 0.86,
      -1.55,
      "night-lamp",
    );
    box(g, -1.8, y + 0.17, -1.0, 1.6, 0.02, 1.4, "#e4c169", "rug");
  }

  const labelAnchor = Object.fromEntries(
    ROOM_IDS.map((id) => {
      const e = ROOM_EXTENTS[id];
      return [
        id,
        new THREE.Vector3(
          e.minX + 0.95,
          e.floor * H + H - 0.3,
          HOUSE_DEPTH / 2,
        ),
      ];
    }),
  ) as Record<RoomId, THREE.Vector3>;

  return {
    group,
    labelAnchor,
    setRoomHighlight(room) {
      for (const id of ROOM_IDS) {
        const m = highlightable[id];
        if (m) m.emissiveIntensity = id === room ? 0.22 : 0;
      }
    },
    update(time) {
      for (const [i, m] of blinkers.entries())
        m.visible = i === 0 ? Math.floor(time * 2) % 2 === 0 : true;
      const flame = blinkers[1];
      if (flame)
        flame.scale.setScalar(0.85 + Math.abs(Math.sin(time * 9)) * 0.3);
    },
    dispose() {
      for (const g of geometries.values()) g.dispose();
      for (const m of materials.values()) m.dispose();
      for (const m of owned) m.dispose();
      group.removeFromParent();
    },
  };
}
