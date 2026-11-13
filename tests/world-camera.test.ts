import { describe, expect, it } from "vitest";
import {
  HOUSE_BOUNDS,
  cameraFrame,
  defaultMode,
} from "../apps/web/src/world/camera";
import { FLOOR_HEIGHT, ROOM_EXTENTS } from "../apps/web/src/world/layout";
import { ROOM_IDS } from "../apps/web/src/world/rooms";

const fits = (
  frame: ReturnType<typeof cameraFrame>,
  aspect: number,
  b: { minX: number; maxX: number; minY: number; maxY: number },
) => {
  const halfH = frame.viewHeight / 2,
    halfW = halfH * aspect,
    e = 1e-9;
  return (
    frame.centre.x - halfW <= b.minX + e &&
    frame.centre.x + halfW >= b.maxX - e &&
    frame.centre.y - halfH <= b.minY + e &&
    frame.centre.y + halfH >= b.maxY - e
  );
};

describe("camera framing", () => {
  it("house frame contains whole house", () => {
    for (const aspect of [16 / 9, 4 / 3, 1])
      for (const benwa of [
        { x: -6, y: 0 },
        { x: 8.25, y: 3 },
        { x: 3, y: 6 },
      ])
        expect(
          fits(
            cameraFrame({ kind: "house" }, aspect, benwa),
            aspect,
            HOUSE_BOUNDS,
          ),
        ).toBe(true);
  });
  it("room frame contains the room", () => {
    for (const room of ROOM_IDS)
      for (const aspect of [16 / 9, 0.46]) {
        const e = ROOM_EXTENTS[room];
        const bounds = {
          minX: e.minX,
          maxX: e.maxX,
          minY: e.floor * FLOOR_HEIGHT,
          maxY: (e.floor + 1) * FLOOR_HEIGHT,
        };
        expect(
          fits(
            cameraFrame({ kind: "room", room }, aspect, { x: 0, y: 0 }),
            aspect,
            bounds,
          ),
          `${room}@${aspect}`,
        ).toBe(true);
      }
  });
  it("narrow aspect frames current room", () => {
    expect(defaultMode(0.46, "library")).toEqual({
      kind: "room",
      room: "library",
    });
    expect(defaultMode(1.6, "library")).toEqual({ kind: "house" });
  });
  it("house frame follows Benwa a little", () => {
    const aspect = 16 / 9;
    const still = cameraFrame({ kind: "house" }, aspect, {
      x: (HOUSE_BOUNDS.minX + HOUSE_BOUNDS.maxX) / 2,
      y: 0,
    });
    const offset = -4;
    const moved = cameraFrame({ kind: "house" }, aspect, {
      x: still.centre.x + offset,
      y: 0,
    });
    const shift = moved.centre.x - still.centre.x;
    expect(shift).toBeLessThan(0);
    expect(Math.abs(shift)).toBeGreaterThanOrEqual(
      Math.abs(offset) * 0.15 - 1e-9,
    );
    expect(Math.abs(shift)).toBeLessThanOrEqual(Math.abs(offset) * 0.35 + 1e-9);
  });
});
