import { describe, expect, it } from "vitest";
import {
  BADGE_LABEL,
  STAGES,
  actionStep,
  outcomeBadge,
  stageTrack,
} from "../apps/web/src/world/progress";

const cyc = (stage: string) => ({ id: "c1", stage });
const act = (status: string, cycleId = "c1") => ({ cycleId, status });

describe("actionStep", () => {
  it("covers every step", () => {
    expect(actionStep(null, null)).toBe("idle");
    expect(actionStep(cyc("DECIDING"), act("SUCCEEDED", "c0"))).toBe(
      "deciding",
    );
    expect(actionStep(cyc("DECIDING"), null)).toBe("deciding");
    expect(actionStep(cyc("EXECUTING"), act("PLANNED"))).toBe("doing");
    expect(actionStep(cyc("VALIDATING"), act("PLANNED"))).toBe("doing");
    expect(actionStep(cyc("VERIFYING"), act("PLANNED"))).toBe("checking");
    expect(actionStep(cyc("DONE"), act("SUCCEEDED"))).toBe("done");
    expect(actionStep(cyc("DONE"), act("FAILED"))).toBe("failed");
    expect(actionStep(cyc("AWAITING_APPROVAL"), act("AWAITING_APPROVAL"))).toBe(
      "waiting",
    );
    expect(actionStep(cyc("DONE"), act("DEFERRED"))).toBe("deferred");
    expect(actionStep(cyc("WAITING_ASSISTANCE"), act("PLANNED"))).toBe(
      "waiting",
    );
  });
});

describe("outcomeBadge", () => {
  const o = (verified: boolean, meaningful: boolean, simulated: boolean) => ({
    verified,
    meaningful,
    simulated,
  });
  it("separates verified, demo and failed", () => {
    expect(
      outcomeBadge({ status: "SUCCEEDED", outcome: o(true, true, false) }),
    ).toBe("verified");
    expect(
      outcomeBadge({ status: "SUCCEEDED", outcome: o(true, true, true) }),
    ).toBe("demo");
    expect(
      outcomeBadge({ status: "SUCCEEDED", outcome: o(true, false, false) }),
    ).toBe("nothing-new");
    expect(outcomeBadge({ status: "FAILED", outcome: null })).toBe("failed");
    expect(outcomeBadge({ status: "PLANNED", outcome: null })).toBe(
      "in-progress",
    );
    expect(outcomeBadge({ status: "AWAITING_APPROVAL", outcome: null })).toBe(
      "waiting",
    );
    expect(outcomeBadge({ status: "DEFERRED", outcome: null })).toBe(
      "deferred",
    );
    expect(BADGE_LABEL.verified).toBe("Verified");
    expect(BADGE_LABEL.waiting).toBe("Waiting for you");
    expect(BADGE_LABEL["nothing-new"]).toBe("Done, nothing new");
  });
});

describe("stageTrack", () => {
  it("empty project track", () => {
    const track = stageTrack({ stage: "DISCOVERY", milestones: [] });
    expect(track).toHaveLength(9);
    expect(track.map((t) => t.state)).toEqual([
      "current",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });
  it("marks real and demo milestones", () => {
    const track = stageTrack({
      stage: "BUILDING",
      milestones: [
        { stage: "DISCOVERY", simulated: false },
        { stage: "RESEARCH", simulated: true },
        { stage: "VALIDATION", simulated: false },
        { stage: "PLANNING", simulated: false },
      ],
    });
    expect(track.map((t) => t.state)).toEqual([
      "done",
      "demo",
      "done",
      "done",
      "current",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    expect(track.map((t) => t.stage)).toEqual([...STAGES]);
    expect(track[6].label).toBe("Launch approval");
    expect(track[8].label).toBe("Revenue evaluation");
  });
});
