import { describe, expect, it } from "vitest";
import {
  ROOM_IDS,
  ROOMS,
  roomForTool,
  selectScene,
  type WorldInput,
} from "../apps/web/src/world/rooms";

const base = (): WorldInput => ({
  status: "RUNNING",
  workerOnline: true,
  cycle: { id: "c1", stage: "EXECUTING" },
  latestAction: { cycleId: "c1", tool: "research.fetch", status: "PLANNED" },
  pendingApprovals: 0,
  openAssistance: 0,
  previousRoom: null,
});

describe("room metadata", () => {
  it("maps every tool to its room", () => {
    const expected: Record<string, string> = {
      "external.request": "hall",
      "workspace.write": "study",
      "workspace.read": "study",
      "workspace.inspect": "study",
      "sandbox.run": "workshop",
      "browser.test": "workshop",
      "research.search": "library",
      "research.fetch": "library",
      "project.plan": "planning",
      "project.advance": "planning",
      "project.reject": "planning",
      "memory.learn": "journal",
      rest: "bedroom",
    };
    for (const [tool, room] of Object.entries(expected))
      expect(roomForTool(tool)).toBe(room);
    expect(roomForTool("nope")).toBeNull();
  });
  it("names and floors every room", () => {
    expect([...ROOM_IDS].sort()).toEqual([
      "bedroom",
      "hall",
      "journal",
      "library",
      "planning",
      "study",
      "workshop",
    ]);
    expect(ROOMS.hall.name).toBe("Front hall");
    expect(ROOMS.planning.name).toBe("Planning room");
    expect(ROOMS.journal.name).toBe("Journal nook");
    expect([ROOMS.hall.floor, ROOMS.study.floor, ROOMS.workshop.floor]).toEqual(
      [0, 0, 0],
    );
    expect([
      ROOMS.library.floor,
      ROOMS.planning.floor,
      ROOMS.journal.floor,
    ]).toEqual([1, 1, 1]);
    expect(ROOMS.bedroom.floor).toBe(2);
  });
});

describe("selectScene", () => {
  it("offline worker sleeps even if status says RUNNING", () => {
    expect(selectScene({ ...base(), workerOnline: false })).toEqual({
      room: "bedroom",
      activity: "sleep",
      label: "Worker offline",
    });
  });
  it("review/error stays put and is confused", () => {
    expect(
      selectScene({
        ...base(),
        status: "REVIEW_REQUIRED",
        previousRoom: "study",
      }),
    ).toEqual({ room: "study", activity: "confused", label: null });
    expect(
      selectScene({
        ...base(),
        status: "ERROR",
        previousRoom: null,
        latestAction: null,
      }).room,
    ).toBe("bedroom");
  });
  it("waiting for you goes to the hall", () => {
    for (const input of [
      { ...base(), status: "WAITING_APPROVAL" },
      { ...base(), status: "WAITING_ASSISTANCE" },
      { ...base(), status: "PAUSED", pendingApprovals: 1 },
      {
        ...base(),
        openAssistance: 1,
        latestAction: {
          cycleId: "c1",
          tool: "research.fetch",
          status: "SUCCEEDED",
        },
      },
    ])
      expect(selectScene(input)).toEqual({
        room: "hall",
        activity: "wait",
        label: null,
      });
  });
  it("paused states go to bed", () => {
    expect(selectScene({ ...base(), status: "RESTING" })).toMatchObject({
      room: "bedroom",
      activity: "sleep",
    });
    for (const status of ["PAUSED", "BUDGET_PAUSED", "QUOTA_PAUSED"])
      expect(selectScene({ ...base(), status })).toMatchObject({
        room: "bedroom",
        activity: "sit",
      });
  });
  it("executing action picks its room", () => {
    expect(selectScene(base())).toEqual({
      room: "library",
      activity: "work",
      label: null,
    });
    for (const stage of ["VALIDATING", "VERIFYING"])
      expect(
        selectScene({ ...base(), cycle: { id: "c1", stage } }),
      ).toMatchObject({
        room: "library",
        activity: "work",
      });
  });
  it("finished or deciding ponders in last action's room", () => {
    expect(
      selectScene({
        ...base(),
        cycle: { id: "c1", stage: "DECIDING" },
        latestAction: {
          cycleId: "c0",
          tool: "research.fetch",
          status: "SUCCEEDED",
        },
      }),
    ).toMatchObject({ room: "library", activity: "ponder" });
    expect(
      selectScene({
        ...base(),
        latestAction: {
          cycleId: "c1",
          tool: "research.fetch",
          status: "SUCCEEDED",
        },
      }),
    ).toMatchObject({ room: "library", activity: "ponder" });
  });
  it("deferred external request only counts while executing", () => {
    expect(
      selectScene({
        ...base(),
        cycle: { id: "c1", stage: "DONE" },
        latestAction: {
          cycleId: "c1",
          tool: "external.request",
          status: "DEFERRED",
        },
      }),
    ).toMatchObject({ room: "hall", activity: "ponder" });
  });
  it("no actions ever sleeps in bedroom", () => {
    expect(
      selectScene({ ...base(), cycle: null, latestAction: null }),
    ).toMatchObject({ room: "bedroom", activity: "sit" });
  });
  it("rest tool sleeps", () => {
    expect(
      selectScene({
        ...base(),
        latestAction: { cycleId: "c1", tool: "rest", status: "PLANNED" },
      }),
    ).toMatchObject({ room: "bedroom", activity: "sleep" });
  });
  it("confused with no previous room falls back to the latest action's room", () => {
    expect(
      selectScene({ ...base(), status: "REVIEW_REQUIRED", previousRoom: null }),
    ).toMatchObject({ room: "library", activity: "confused" });
  });
  it("pending review does not hide work that is really executing", () => {
    expect(selectScene({ ...base(), pendingApprovals: 1 })).toEqual({
      room: "library",
      activity: "work",
      label: "Needs your review",
    });
    expect(selectScene({ ...base(), openAssistance: 1 })).toEqual({
      room: "library",
      activity: "work",
      label: "Needs your review",
    });
  });
});
