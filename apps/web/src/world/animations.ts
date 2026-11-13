import type { WorldTarget } from "./rooms";

export type AnimName =
  | "idle"
  | "walk"
  | "climb"
  | "type"
  | "read"
  | "tinker"
  | "pin"
  | "write"
  | "post"
  | "wait"
  | "sleep"
  | "sit"
  | "ponder"
  | "confused"
  | "hop"
  | "slump"
  | "dance"
  | "bigDance";

export type Prop =
  | "none"
  | "book"
  | "letter"
  | "pencil"
  | "note"
  | "question"
  | "zzz"
  | "smoke"
  | "coins";

/** All angles in radians; 0 is the model's rest pose. */
export interface Pose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  armLRaise: number;
  armRRaise: number;
  /** Body lift in Benwa-heights. */
  bob: number;
  lean: number;
  tilt: number;
  squash: number;
  eyeOpen: number;
  leafSway: number;
  turn: number;
  prop: Prop;
}

export const ONE_SHOT_SECONDS = {
  hop: 1.2,
  slump: 2.5,
  dance: 3,
  bigDance: 5,
} as const;
export type OneShot = keyof typeof ONE_SHOT_SECONDS;
export const isOneShot = (anim: AnimName): anim is OneShot =>
  anim in ONE_SHOT_SECONDS;

const REST: Pose = {
  legL: 0,
  legR: 0,
  armL: 0,
  armR: 0,
  armLRaise: 0,
  armRRaise: 0,
  bob: 0,
  lean: 0,
  tilt: 0,
  squash: 0,
  eyeOpen: 1,
  leafSway: 0,
  turn: 0,
  prop: "none",
};

const { sin, abs, PI } = Math;
/** Quantise time a little so motion looks charmingly stop-motion. */
const step = (t: number, fps = 12) => Math.floor(t * fps) / fps;
const blink = (t: number) => (t % 6.4 > 6.25 ? 0.1 : 1);
const breathe = (t: number) => ({
  squash: sin(t * 1.6) * 0.012,
  leafSway: sin(t * 1.1) * 0.12,
});

export function poseAt(anim: AnimName, time: number): Pose {
  const t = step(time);
  const base: Pose = { ...REST, ...breathe(t), eyeOpen: blink(t) };
  switch (anim) {
    case "idle":
      return { ...base, bob: sin(t * 1.2) * 0.008, tilt: sin(t * 0.7) * 0.03 };
    case "walk": {
      const swing = sin(t * 9) * 0.55;
      return {
        ...base,
        legL: swing,
        legR: -swing,
        armL: -swing * 0.7,
        armR: swing * 0.7,
        bob: abs(sin(t * 9)) * 0.04,
        tilt: sin(t * 9) * 0.05,
        leafSway: sin(t * 9) * 0.25,
      };
    }
    case "climb": {
      const swing = sin(t * 8) * 0.7;
      return {
        ...base,
        legL: swing,
        legR: -swing,
        armL: 1.2 + swing * 0.5,
        armR: 1.2 - swing * 0.5,
        bob: abs(sin(t * 8)) * 0.05,
        lean: 0.15,
      };
    }
    case "type": {
      const tap = (n: number) => (Math.floor(t * 6 + n) % 2 ? 0.15 : -0.05);
      const scratch = t % 9 > 7.5;
      return {
        ...base,
        armL: 0.9 + tap(0),
        armR: scratch ? 0.4 : 0.9 + tap(1),
        armRRaise: scratch ? 1.6 + sin(t * 20) * 0.15 : 0,
        lean: 0.2,
      };
    }
    case "read":
      return {
        ...base,
        armL: 1.1,
        armR: 1.1,
        armLRaise: -0.25,
        armRRaise: t % 5 > 4.6 ? 0.5 : -0.25,
        lean: 0.12,
        tilt: sin(t * 0.8) * 0.05,
        prop: "book",
      };
    case "tinker":
      return {
        ...base,
        armL: 1.0,
        armR: 0.7 + abs(sin(t * 7)) * 0.6,
        lean: 0.25 + sin(t * 2) * 0.05,
        turn: sin(t * 0.9) * 0.2,
        bob: t % 4 > 3.6 ? 0.05 : 0,
      };
    case "pin": {
      const reach = t % 4 < 2;
      return {
        ...base,
        armR: reach ? 1.4 : 0.2,
        armRRaise: reach ? 0.9 : 0,
        bob: reach ? 0.03 : 0,
        lean: reach ? 0.1 : -0.08,
        prop: "note",
      };
    }
    case "write":
      return {
        ...base,
        armR: 0.9 + sin(t * 14) * 0.08,
        armL: 0.6,
        lean: 0.3,
        tilt: sin(t * 1.3) * 0.04,
        prop: "pencil",
      };
    case "post": {
      const phase = t % 6;
      const posting = phase < 2;
      return {
        ...base,
        armR: posting ? 1.3 : 0,
        lean: posting ? 0.15 : 0,
        legR: posting ? 0 : abs(sin(t * 6)) * 0.15,
        prop: posting ? "letter" : "none",
      };
    }
    case "wait":
      return {
        ...base,
        legR: abs(sin(t * 6)) * 0.18,
        turn: sin(t * 0.5) * 0.45,
        tilt: sin(t * 0.5) * 0.04,
      };
    case "sleep":
      return {
        ...base,
        eyeOpen: 0.1,
        tilt: -0.09,
        bob: sin(t * 1.1) * 0.006,
        squash: sin(t * 1.1) * 0.02,
        armL: 0.15,
        armR: 0.15,
        prop: "zzz",
      };
    case "sit":
      return {
        ...base,
        legL: 1.3,
        legR: 1.3,
        bob: -0.12,
        armL: 0.3,
        armR: 0.3,
        tilt: sin(t * 0.6) * 0.04,
      };
    case "ponder":
      return {
        ...base,
        armR: 1.3,
        armRRaise: 0.8,
        tilt: 0.12,
        turn: sin(t * 0.4) * 0.3,
        prop: "note",
      };
    case "confused":
      return {
        ...base,
        tilt: sin(t * 2) * 0.18,
        armLRaise: 0.6,
        armRRaise: 0.6,
        turn: sin(t * 1.4) * 0.5,
        prop: "question",
      };
    case "hop": {
      const p = Math.min(time / ONE_SHOT_SECONDS.hop, 1);
      const height = sin(p * PI);
      return {
        ...base,
        bob: height * 0.3,
        squash: p < 0.15 || p > 0.9 ? -0.08 : 0.05,
        armLRaise: height * 1.2,
        armRRaise: height * 1.2,
      };
    }
    case "slump": {
      const p = Math.min(time / ONE_SHOT_SECONDS.slump, 1);
      return {
        ...base,
        lean: 0.35 * sin(p * PI),
        squash: -0.08 * sin(p * PI),
        armL: -0.2,
        armR: -0.2,
        eyeOpen: 0.4,
        prop: p < 0.6 ? "smoke" : "none",
      };
    }
    case "dance":
    case "bigDance": {
      const fast = anim === "bigDance" ? 10 : 7;
      return {
        ...base,
        bob: abs(sin(t * fast)) * 0.12,
        armLRaise: 1.2 + sin(t * fast) * 0.6,
        armRRaise: 1.2 - sin(t * fast) * 0.6,
        legL: sin(t * fast) * 0.4,
        legR: sin(t * fast) * 0.4,
        turn: t * (anim === "bigDance" ? 4 : 2),
        tilt: sin(t * fast * 0.5) * 0.15,
        prop: anim === "bigDance" ? "coins" : "none",
      };
    }
  }
}

const WORK_ANIM = {
  hall: "post",
  study: "type",
  workshop: "tinker",
  library: "read",
  planning: "pin",
  journal: "write",
  bedroom: "sleep",
} as const satisfies Record<WorldTarget["room"], AnimName>;

export function animForTarget(target: WorldTarget): AnimName {
  return target.activity === "work" ? WORK_ANIM[target.room] : target.activity;
}
