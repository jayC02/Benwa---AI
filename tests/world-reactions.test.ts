import { describe, expect, it } from "vitest";
import {
  detectReactions,
  type ReactionInput,
} from "../apps/web/src/world/reactions";

const good = { verified: true, meaningful: true, simulated: false };
const snap = (over: Partial<ReactionInput> = {}): ReactionInput => ({
  actions: [{ id: "a1", status: "SUCCEEDED", outcome: good }],
  milestones: [],
  netMinor: "0",
  ...over,
});

describe("detectReactions", () => {
  it("first snapshot triggers nothing", () => {
    expect(detectReactions(null, snap())).toEqual([]);
  });
  it("verified success hops", () => {
    const next = snap({
      actions: [
        { id: "a2", status: "SUCCEEDED", outcome: good },
        ...snap().actions,
      ],
    });
    expect(detectReactions(snap(), next)).toEqual(["hop"]);
    const planned = snap({
      actions: [{ id: "a1", status: "PLANNED", outcome: null }],
    });
    expect(detectReactions(planned, snap())).toEqual(["hop"]);
  });
  it("simulated success does not hop", () => {
    const next = snap({
      actions: [
        {
          id: "a2",
          status: "SUCCEEDED",
          outcome: { ...good, simulated: true },
        },
        ...snap().actions,
      ],
    });
    expect(detectReactions(snap(), next)).toEqual([]);
  });
  it("failure slumps", () => {
    const next = snap({
      actions: [
        { id: "a2", status: "FAILED", outcome: null },
        ...snap().actions,
      ],
    });
    expect(detectReactions(snap(), next)).toEqual(["slump"]);
  });
  it("unchanged action does nothing", () => {
    expect(detectReactions(snap(), snap())).toEqual([]);
  });
  it("real milestone dances, demo milestone does not", () => {
    expect(
      detectReactions(
        snap(),
        snap({ milestones: [{ id: "m1", simulated: false }] }),
      ),
    ).toContain("dance");
    expect(
      detectReactions(
        snap(),
        snap({ milestones: [{ id: "m1", simulated: true }] }),
      ),
    ).not.toContain("dance");
  });
  it("profit increase triggers bigDance", () => {
    expect(detectReactions(snap(), snap({ netMinor: "1500" }))).toContain(
      "bigDance",
    );
    expect(
      detectReactions(snap({ netMinor: "1500" }), snap({ netMinor: "900" })),
    ).not.toContain("bigDance");
  });
  it("order and cap", () => {
    const next = snap({
      actions: [
        { id: "a3", status: "FAILED", outcome: null },
        { id: "a2", status: "SUCCEEDED", outcome: good },
        ...snap().actions,
      ],
      milestones: [{ id: "m1", simulated: false }],
      netMinor: "100",
    });
    expect(detectReactions(snap(), next)).toEqual(["slump", "hop", "dance"]);
  });
});
