import { describe, it, expect } from "vitest";
import {
  applySkillOutcome,
  emptySkills,
  readSkillRatings,
} from "../packages/core/src/skills";

describe("verified skill progression", () => {
  it("rewards relevant skills for novel implementation and saved ideas", () => {
    const first = applySkillOutcome(emptySkills(), {
      tool: "workspace.write",
      target: "calculator.ts",
      progress: true,
      failed: false,
    });
    expect(first.ratings).toMatchObject({
      coding: 1,
      creativity: 0.5,
      intelligence: 0.5,
      research: 0,
    });
    const plan = applySkillOutcome(first.ratings, {
      tool: "project.plan",
      progress: true,
      failed: false,
    });
    expect(plan.ratings).toMatchObject({
      planning: 1,
      creativity: 1,
      business: 0.5,
    });
    expect(first.ratings.creativity).toBe(0.5);
  });
  it("does not award coding for writing ordinary prose", () => {
    const next = applySkillOutcome(emptySkills(), {
      tool: "workspace.write",
      target: "notes.md",
      progress: true,
      failed: false,
    });
    expect(next.ratings.coding).toBe(0);
    expect(next.ratings.planning).toBe(0.5);
  });
  it("reduces relevant skills after failures and rewards a successful change in approach", () => {
    const initial = {
      ...emptySkills(),
      coding: 10,
      testing: 10,
      intelligence: 10,
      adaptability: 10,
    };
    const failed = applySkillOutcome(initial, {
      tool: "browser.test",
      progress: false,
      failed: true,
      repeatedFailure: true,
    });
    expect(failed.ratings).toMatchObject({
      coding: 9.5,
      testing: 9,
      intelligence: 9.5,
      adaptability: 9,
    });
    const recovered = applySkillOutcome(failed.ratings, {
      tool: "browser.test",
      progress: true,
      failed: false,
      recovered: true,
    });
    expect(recovered.ratings).toMatchObject({
      coding: 10,
      testing: 10,
      adaptability: 10,
    });
    expect(initial.coding).toBe(10);
  });
  it("gives no points for routine work, duplicate evidence, searching or waiting", () => {
    const initial = { ...emptySkills(), coding: 10 };
    for (const tool of [
      "workspace.write",
      "workspace.read",
      "research.search",
      "memory.learn",
      "rest",
    ])
      expect(
        applySkillOutcome(initial, { tool, progress: false, failed: false })
          .ratings,
      ).toEqual(initial);
    expect(
      applySkillOutcome(initial, {
        tool: "research.search",
        progress: true,
        failed: false,
      }).ratings,
    ).toEqual(initial);
  });
  it("validates persisted values and keeps every rating between zero and one hundred", () => {
    expect(readSkillRatings({ coding: "1000" })).toEqual(emptySkills());
    expect(
      applySkillOutcome(emptySkills(), {
        tool: "workspace.write",
        progress: false,
        failed: true,
      }).ratings.coding,
    ).toBe(0);
    expect(
      applySkillOutcome(
        { ...emptySkills(), coding: 100 },
        { tool: "workspace.write", progress: true, failed: false },
      ).ratings.coding,
    ).toBe(100);
  });
});
