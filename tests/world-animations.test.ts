import { describe, expect, it } from "vitest";
import {
  ONE_SHOT_SECONDS,
  animForTarget,
  poseAt,
  type AnimName,
} from "../apps/web/src/world/animations";
import type { Activity, RoomId } from "../apps/web/src/world/rooms";

const ALL: AnimName[] = [
  "idle",
  "walk",
  "climb",
  "type",
  "read",
  "tinker",
  "pin",
  "write",
  "post",
  "wait",
  "sleep",
  "sit",
  "ponder",
  "confused",
  "hop",
  "slump",
  "dance",
  "bigDance",
];
const samples = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  return out;
};

describe("poses", () => {
  it("walk legs alternate", () => {
    let max = 0;
    for (const t of samples(0, 2, 0.1)) {
      const p = poseAt("walk", t);
      expect(p.legL).toBeCloseTo(-p.legR, 6);
      max = Math.max(max, Math.abs(p.legL));
    }
    expect(max).toBeGreaterThan(0.3);
  });
  it("sleep has closed eyes", () => {
    for (const t of samples(0, 5, 0.25)) {
      const p = poseAt("sleep", t);
      expect(p.eyeOpen).toBeLessThanOrEqual(0.15);
      expect(p.prop).toBe("zzz");
    }
  });
  it("idle blinks briefly", () => {
    const eyes = samples(0, 7, 0.02).map((t) => poseAt("idle", t).eyeOpen);
    expect(eyes.some((e) => e < 0.3)).toBe(true);
    expect(
      eyes.filter((e) => e === 1).length / eyes.length,
    ).toBeGreaterThanOrEqual(0.9);
  });
  it("every pose is finite", () => {
    for (const anim of ALL)
      for (const t of [0, 0.5, 3.3, 100]) {
        const p = poseAt(anim, t);
        for (const [key, value] of Object.entries(p))
          if (key !== "prop")
            expect(Number.isFinite(value), `${anim}.${key}@${t}`).toBe(true);
      }
  });
  it("one-shots carry props", () => {
    expect(
      samples(0, ONE_SHOT_SECONDS.slump, 0.1).some(
        (t) => poseAt("slump", t).prop === "smoke",
      ),
    ).toBe(true);
    expect(
      samples(0, ONE_SHOT_SECONDS.bigDance, 0.1).some(
        (t) => poseAt("bigDance", t).prop === "coins",
      ),
    ).toBe(true);
    expect(poseAt("confused", 1).prop).toBe("question");
    expect(ONE_SHOT_SECONDS).toEqual({
      hop: 1.2,
      slump: 2.5,
      dance: 3,
      bigDance: 5,
    });
  });
});

describe("animForTarget", () => {
  it("maps rooms and activities", () => {
    const work: Record<RoomId, AnimName> = {
      hall: "post",
      study: "type",
      workshop: "tinker",
      library: "read",
      planning: "pin",
      journal: "write",
      bedroom: "sleep",
    };
    for (const [room, anim] of Object.entries(work))
      expect(
        animForTarget({ room: room as RoomId, activity: "work", label: null }),
      ).toBe(anim);
    const other: Record<Exclude<Activity, "work">, AnimName> = {
      ponder: "ponder",
      sleep: "sleep",
      sit: "sit",
      wait: "wait",
      confused: "confused",
    };
    for (const [activity, anim] of Object.entries(other))
      expect(
        animForTarget({
          room: "study",
          activity: activity as Activity,
          label: null,
        }),
      ).toBe(anim);
  });
});
