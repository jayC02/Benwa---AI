import {
  ONE_SHOT_SECONDS,
  animForTarget,
  isOneShot,
  type AnimName,
} from "./animations";
import {
  CLIMB_SECONDS,
  FLOOR_HEIGHT,
  ROOM_EXTENTS,
  WALK_SPEED,
  WORK_SPOT,
  planPath,
  type Waypoint,
} from "./layout";
import type { Reaction } from "./reactions";
import { ROOM_IDS, type RoomId, type WorldTarget } from "./rooms";

const MAX_QUEUE = 2;

export interface DirectorState {
  floor: number;
  x: number;
  y: number;
  /** 0 faces the camera (+Z); ±PI/2 walks along ±X. */
  facing: number;
  target: WorldTarget;
  path: Waypoint[];
  queue: Reaction[];
  oneShot: { anim: AnimName; started: number } | null;
  loopStarted: number;
}

export function createDirector(
  target: WorldTarget,
  now: number,
): DirectorState {
  const floor = ROOM_EXTENTS[target.room].floor;
  return {
    floor,
    x: WORK_SPOT[target.room].x,
    y: floor * FLOOR_HEIGHT,
    facing: 0,
    target,
    path: [],
    queue: [],
    oneShot: null,
    loopStarted: now,
  };
}

const sameTarget = (a: WorldTarget, b: WorldTarget) =>
  a.room === b.room && a.activity === b.activity && a.label === b.label;

export function setTarget(
  s: DirectorState,
  target: WorldTarget,
  now: number,
): DirectorState {
  if (sameTarget(s.target, target)) return s;
  if (s.target.room === target.room && s.path.length) return { ...s, target };
  // Finish any climb in progress so he never hangs between floors.
  const climbing = s.path[0]?.mode === "climb" ? s.path[0] : null;
  const from = climbing
    ? { floor: climbing.floor, x: climbing.x }
    : { floor: s.floor, x: s.x };
  const path = [
    ...(climbing ? [climbing] : []),
    ...planPath(from, target.room),
  ];
  return { ...s, target, path, loopStarted: now };
}

export function enqueue(
  s: DirectorState,
  reactions: Reaction[],
): DirectorState {
  if (!reactions.length) return s;
  // Keep only the newest few so time away never turns into a long stale show.
  return { ...s, queue: [...s.queue, ...reactions].slice(-MAX_QUEUE) };
}

function move(s: DirectorState, dt: number): DirectorState {
  const [next, ...rest] = s.path;
  if (next.mode === "walk") {
    const dx = next.x - s.x;
    const stride = WALK_SPEED * dt;
    if (Math.abs(dx) <= stride)
      return {
        ...s,
        x: next.x,
        path: rest,
        facing: Math.sign(dx) * (Math.PI / 2) || s.facing,
      };
    return {
      ...s,
      x: s.x + Math.sign(dx) * stride,
      facing: Math.sign(dx) * (Math.PI / 2),
    };
  }
  const goalY = next.floor * FLOOR_HEIGHT;
  const dy = goalY - s.y;
  const rise = (FLOOR_HEIGHT / CLIMB_SECONDS) * dt;
  if (Math.abs(dy) <= rise)
    return { ...s, y: goalY, floor: next.floor, path: rest, facing: Math.PI };
  return { ...s, y: s.y + Math.sign(dy) * rise, facing: Math.PI };
}

export function tick(
  s: DirectorState,
  dt: number,
  now: number,
): { state: DirectorState; anim: AnimName; animTime: number } {
  if (s.path.length) {
    const mode = s.path[0].mode;
    const moved = move(s, dt);
    if (moved.path.length)
      return {
        state: moved,
        anim: mode === "climb" ? "climb" : "walk",
        animTime: now,
      };
    s = { ...moved, facing: 0, loopStarted: now };
  }
  if (s.oneShot) {
    const elapsed = now - s.oneShot.started;
    const anim = s.oneShot.anim;
    if (isOneShot(anim) && elapsed < ONE_SHOT_SECONDS[anim])
      return { state: s, anim, animTime: elapsed };
    s = { ...s, oneShot: null, loopStarted: now };
  }
  if (s.queue.length) {
    const [anim, ...queue] = s.queue;
    return {
      state: { ...s, queue, oneShot: { anim, started: now } },
      anim,
      animTime: 0,
    };
  }
  return {
    state: s,
    anim: animForTarget(s.target),
    animTime: now - s.loopStarted,
  };
}

export function currentRoom(s: DirectorState): RoomId | null {
  return (
    ROOM_IDS.find((id) => {
      const e = ROOM_EXTENTS[id];
      return e.floor === s.floor && s.x >= e.minX && s.x <= e.maxX;
    }) ?? null
  );
}
