import { FLOOR_HEIGHT, ROOM_EXTENTS } from "./layout";
import type { RoomId } from "./rooms";

export type CameraMode = { kind: "house" } | { kind: "room"; room: RoomId };
/** Orthographic framing in world units. */
export interface Frame {
  centre: { x: number; y: number };
  viewHeight: number;
}

/** Includes the ground slab, attic roof and stair tower. */
export const HOUSE_BOUNDS = { minX: -8, maxX: 9.5, minY: -0.4, maxY: 10.6 };
const MARGIN = 1.08;
const ROOM_MARGIN = 1.15;
const FOLLOW = 0.25;
const NARROW = 0.9;

function fit(
  b: { minX: number; maxX: number; minY: number; maxY: number },
  aspect: number,
  margin: number,
) {
  const w = b.maxX - b.minX,
    h = b.maxY - b.minY;
  return Math.max(h, w / aspect) * margin;
}

export function cameraFrame(
  mode: CameraMode,
  aspect: number,
  benwa: { x: number; y: number },
): Frame {
  if (mode.kind === "room") {
    const e = ROOM_EXTENTS[mode.room];
    const b = {
      minX: e.minX,
      maxX: e.maxX,
      minY: e.floor * FLOOR_HEIGHT,
      maxY: (e.floor + 1) * FLOOR_HEIGHT,
    };
    return {
      centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      viewHeight: fit(b, aspect, ROOM_MARGIN),
    };
  }
  const b = HOUSE_BOUNDS;
  const viewHeight = fit(b, aspect, MARGIN);
  const midX = (b.minX + b.maxX) / 2;
  const slack = Math.max(0, (viewHeight * aspect) / 2 - (b.maxX - b.minX) / 2);
  const shift = Math.max(-slack, Math.min(slack, (benwa.x - midX) * FOLLOW));
  return { centre: { x: midX + shift, y: (b.minY + b.maxY) / 2 }, viewHeight };
}

export function defaultMode(aspect: number, benwaRoom: RoomId): CameraMode {
  return aspect < NARROW
    ? { kind: "room", room: benwaRoom }
    : { kind: "house" };
}
