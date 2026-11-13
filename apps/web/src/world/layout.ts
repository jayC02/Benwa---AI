import type { RoomId } from "./rooms";

export const FLOOR_HEIGHT = 3;
export const HOUSE_DEPTH = 4;
export const STAIR_X = 8.25;
export const STAIR_MIN_X = 7.5;
export const STAIR_MAX_X = 9;
export const WALK_SPEED = 3.5;
export const CLIMB_SECONDS = 1.2;

export const ROOM_EXTENTS: Record<
  RoomId,
  { floor: 0 | 1 | 2; minX: number; maxX: number }
> = {
  hall: { floor: 0, minX: -7.5, maxX: -2.5 },
  study: { floor: 0, minX: -2.5, maxX: 2.5 },
  workshop: { floor: 0, minX: 2.5, maxX: 7.5 },
  library: { floor: 1, minX: -7.5, maxX: -2.5 },
  planning: { floor: 1, minX: -2.5, maxX: 2.5 },
  journal: { floor: 1, minX: 2.5, maxX: 7.5 },
  bedroom: { floor: 2, minX: -2.5, maxX: 7.5 },
};

/** Where Benwa stands to do the room's job: in front of the props, slightly toward the open front. */
export const WORK_SPOT: Record<RoomId, { x: number; z: number }> = {
  hall: { x: -5.6, z: 0.6 },
  study: { x: -0.3, z: 0.6 },
  workshop: { x: 5, z: 0.6 },
  library: { x: -4.6, z: 0.6 },
  planning: { x: 0.2, z: 0.6 },
  journal: { x: 5.2, z: 0.6 },
  bedroom: { x: 3.4, z: 0.6 },
};

export interface Waypoint {
  floor: number;
  x: number;
  mode: "walk" | "climb";
}

export function planPath(
  from: { floor: number; x: number },
  to: RoomId,
): Waypoint[] {
  const goal = { floor: ROOM_EXTENTS[to].floor, x: WORK_SPOT[to].x };
  const path: Waypoint[] = [];
  if (from.floor !== goal.floor) {
    if (from.x !== STAIR_X)
      path.push({ floor: from.floor, x: STAIR_X, mode: "walk" });
    const step = goal.floor > from.floor ? 1 : -1;
    for (let f = from.floor + step; f !== goal.floor + step; f += step)
      path.push({ floor: f, x: STAIR_X, mode: "climb" });
    path.push({ floor: goal.floor, x: goal.x, mode: "walk" });
  } else if (from.x !== goal.x)
    path.push({ floor: goal.floor, x: goal.x, mode: "walk" });
  return path;
}

export function pathSeconds(
  from: { floor: number; x: number },
  path: Waypoint[],
): number {
  let seconds = 0,
    x = from.x;
  for (const w of path) {
    seconds +=
      w.mode === "climb" ? CLIMB_SECONDS : Math.abs(w.x - x) / WALK_SPEED;
    x = w.x;
  }
  return seconds;
}
