import { describe, expect, it } from "vitest";
import {
  createDirector,
  currentRoom,
  enqueue,
  setTarget,
  tick,
  type DirectorState,
} from "../apps/web/src/world/director";
import {
  ONE_SHOT_SECONDS,
  type AnimName,
} from "../apps/web/src/world/animations";
import { WALK_SPEED, WORK_SPOT, planPath } from "../apps/web/src/world/layout";
import type { RoomId } from "../apps/web/src/world/rooms";

const work = (room: RoomId) => ({
  room,
  activity: "work" as const,
  label: null,
});
const DT = 0.1;
function run(s: DirectorState, now: number, seconds: number) {
  const anims: AnimName[] = [];
  const xs: number[] = [];
  let state = s,
    t = now;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    const r = tick(state, DT, t);
    state = r.state;
    anims.push(r.anim);
    xs.push(state.x);
  }
  return { state, anims, xs, now: t };
}

describe("director", () => {
  it("starts at work spot playing room loop", () => {
    const s = createDirector(work("library"), 0);
    const r = tick(s, DT, DT);
    expect(r.anim).toBe("read");
    expect(r.state.x).toBe(WORK_SPOT.library.x);
    expect(r.state.floor).toBe(1);
    expect(currentRoom(r.state)).toBe("library");
  });
  it("walks then climbs then works", () => {
    let s = createDirector(work("study"), 0);
    s = setTarget(s, work("library"), 0);
    const facings: number[] = [];
    let state = s,
      t = 0;
    const anims: AnimName[] = [];
    for (let i = 0; i < 80; i++) {
      t += DT;
      const r = tick(state, DT, t);
      state = r.state;
      anims.push(r.anim);
      if (r.anim === "walk") facings.push(state.facing);
    }
    const firstWalk = anims.indexOf("walk"),
      firstClimb = anims.indexOf("climb"),
      firstRead = anims.indexOf("read");
    expect(firstWalk).toBe(0);
    expect(firstClimb).toBeGreaterThan(firstWalk);
    expect(firstRead).toBeGreaterThan(firstClimb);
    expect(firstRead * DT).toBeLessThan(8);
    for (const f of facings)
      expect(Math.abs(Math.abs(f) - Math.PI / 2)).toBeLessThan(1e-9);
    expect(state.facing).toBe(0);
    expect(state.floor).toBe(1);
    expect(state.x).toBe(WORK_SPOT.library.x);
  });
  it("retargets mid-walk from current position", () => {
    let s = setTarget(createDirector(work("hall"), 0), work("workshop"), 0);
    const first = run(s, 0, 1);
    s = first.state;
    const x = s.x;
    expect(x).toBeGreaterThan(WORK_SPOT.hall.x);
    s = setTarget(s, work("study"), first.now);
    expect(s.path).toEqual(planPath({ floor: 0, x }, "study"));
    const second = run(s, first.now, 3);
    let prev = x;
    for (const next of second.xs) {
      expect(Math.abs(next - prev)).toBeLessThanOrEqual(WALK_SPEED * DT + 1e-9);
      prev = next;
    }
    expect(second.state.x).toBe(WORK_SPOT.study.x);
  });
  it("reactions wait until arrival", () => {
    let s = setTarget(createDirector(work("hall"), 0), work("study"), 0);
    s = enqueue(s, ["hop"]);
    const r = run(s, 0, 4);
    const firstHop = r.anims.indexOf("hop");
    const lastWalk = r.anims.lastIndexOf("walk");
    expect(lastWalk).toBeGreaterThanOrEqual(0);
    expect(firstHop).toBeGreaterThan(lastWalk);
    const hops = r.anims.filter((a) => a === "hop").length;
    expect(hops * DT).toBeCloseTo(ONE_SHOT_SECONDS.hop, 0);
    expect(r.anims.at(-1)).toBe("type");
  });
  it("reactions play in sequence", () => {
    const s = enqueue(createDirector(work("study"), 0), ["slump", "hop"]);
    const r = run(s, 0, 5);
    const firstSlump = r.anims.indexOf("slump"),
      firstHop = r.anims.indexOf("hop");
    expect(firstSlump).toBe(0);
    expect(firstHop).toBeGreaterThan(r.anims.lastIndexOf("slump"));
    expect(r.anims.at(-1)).toBe("type");
  });
  it("same target does not restart", () => {
    const s = createDirector(work("study"), 0);
    const again = setTarget(s, work("study"), 5);
    expect(again.path).toEqual([]);
    expect(again.loopStarted).toBe(s.loopStarted);
  });
  it("caps the reaction queue so a backlog never plays out", () => {
    let s = createDirector(work("study"), 0);
    s = enqueue(s, ["hop", "slump", "dance"]);
    s = enqueue(s, ["bigDance", "hop"]);
    expect(s.queue).toEqual(["bigDance", "hop"]);
  });
});
