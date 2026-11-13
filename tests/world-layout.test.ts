import { describe, expect, it } from "vitest";
import {
  ROOM_EXTENTS,
  STAIR_X,
  WORK_SPOT,
  pathSeconds,
  planPath,
} from "../apps/web/src/world/layout";
import { ROOM_IDS } from "../apps/web/src/world/rooms";

describe("house layout", () => {
  it("work spots sit inside their rooms", () => {
    for (const id of ROOM_IDS) {
      expect(WORK_SPOT[id].x).toBeGreaterThan(ROOM_EXTENTS[id].minX);
      expect(WORK_SPOT[id].x).toBeLessThan(ROOM_EXTENTS[id].maxX);
    }
  });
  it("same floor walks directly", () => {
    expect(planPath({ floor: 0, x: -5 }, "study")).toEqual([
      { floor: 0, x: WORK_SPOT.study.x, mode: "walk" },
    ]);
  });
  it("different floor goes via stairs", () => {
    expect(planPath({ floor: 0, x: -5 }, "library")).toEqual([
      { floor: 0, x: STAIR_X, mode: "walk" },
      { floor: 1, x: STAIR_X, mode: "climb" },
      { floor: 1, x: WORK_SPOT.library.x, mode: "walk" },
    ]);
  });
  it("attic climbs two floors one at a time", () => {
    const climbs = planPath(
      { floor: 0, x: WORK_SPOT.hall.x },
      "bedroom",
    ).filter((w) => w.mode === "climb");
    expect(climbs.map((w) => w.floor)).toEqual([1, 2]);
  });
  it("climbs down too", () => {
    const path = planPath({ floor: 2, x: WORK_SPOT.bedroom.x }, "hall");
    expect(path.filter((w) => w.mode === "climb").map((w) => w.floor)).toEqual([
      1, 0,
    ]);
    expect(path.at(-1)).toEqual({
      floor: 0,
      x: WORK_SPOT.hall.x,
      mode: "walk",
    });
  });
  it("already there is empty", () => {
    expect(planPath({ floor: 0, x: WORK_SPOT.study.x }, "study")).toEqual([]);
  });
  it("longest trip is under 8 seconds", () => {
    const from = { floor: 0, x: WORK_SPOT.hall.x };
    expect(pathSeconds(from, planPath(from, "bedroom"))).toBeLessThan(8);
  });
});
