import { describe, expect, it } from "vitest";
import type { AgentContext } from "../packages/core/src/provider";
import { packGeminiContext } from "../packages/core/src/gemini/context";
import {
  estimatedInput,
  geminiPayload,
} from "../packages/core/src/gemini/transport";
import {
  classifyTask,
  rankCandidates,
} from "../packages/core/src/gemini/policy";
import { modelCatalog } from "../packages/core/src/gemini/catalog";

function context(): AgentContext {
  return {
    state: { name: "Benwa", energy: 70 },
    guidance: ["Change a failed strategy before repeating it."],
    projects: [
      {
        id: "project-1",
        name: "Maker Margin",
        stage: "TESTING",
        score: 10,
        description: "Build and test the existing break-even calculator.",
        hypothesis: {
          successCriterion: "All three functional assertions pass.",
        },
        tasks: [
          {
            id: "current-task",
            title: "Test the real calculator",
            status: "PENDING",
            stage: "TESTING",
          },
        ],
        goals: [
          {
            id: "goal-1",
            title: "Produce a working calculator",
            status: "ACTIVE",
          },
        ],
        checkpoint: {
          files: [{ path: "index.html", bytes: 25000 }],
          staleAttempts: 3,
        },
      },
    ],
    memories: [
      {
        id: "memory-1",
        content: "The calculator's overhead input is still missing.",
        verified: true,
      },
    ],
    recent: [],
    restrictions: [
      { projectId: "project-1", level: 2, blockedStrategy: "repeat research" },
    ],
    financial: { expenses: 0n },
    approvedHosts: "*",
    portfolio: "Focus on the current project.",
    capabilities: {
      sandbox: false,
      browser: true,
      web: "public HTTPS",
      search: "LangSearch",
      externalExecution: false,
    },
  };
}

describe("bounded Gemini context", () => {
  it("leaves an already fitting prompt intact", () => {
    const c = context();
    expect(packGeminiContext(c, 32000)).toEqual(geminiPayload(c));
  });
  it("fits oversized history without losing the objective, important memory or restrictions", () => {
    const c = context();
    c.recent = Array.from({ length: 12 }, (_, i) => ({
      id: `action-${i}`,
      tool: "research.fetch",
      status: "SUCCEEDED",
      projectId: "project-1",
      outcome: {
        summary: "Already researched this source",
        evidenceExcerpt: 'quoted "source"\n😀'.repeat(2000),
      },
    }));
    c.projects[0].tasks = [
      ...Array.from({ length: 70 }, (_, i) => ({
        id: `done-${i}`,
        status: "COMPLETED",
        title: "An earlier task",
      })),
      ...(c.projects[0].tasks as unknown[]),
    ];
    const saved = structuredClone(c);
    const packed = packGeminiContext(c, 32000);
    expect(estimatedInput(packed)).toBeLessThanOrEqual(32000);
    const sent = JSON.parse(packed.contents).context;
    expect(sent.projects[0].description).toBe(c.projects[0].description);
    expect(sent.projects[0].hypothesis).toEqual(c.projects[0].hypothesis);
    expect(sent.projects[0].tasks[0].id).toBe("current-task");
    expect(sent.projects[0].goals[0].id).toBe("goal-1");
    expect(sent.memories[0].content).toContain(
      "overhead input is still missing",
    );
    expect(sent.recent[0].id).toBe("action-0");
    expect(sent.restrictions).toEqual(c.restrictions);
    expect(sent.guidance).toEqual(c.guidance);
    expect(sent.capabilities).toEqual(c.capabilities);
    expect(sent.contextWindow.mode).toBe("focused");
    expect(c).toEqual(saved);
  });
  it("keeps a correct continuation cursor when an observation needs a smaller file slice", () => {
    const c = context();
    const content = 'const text = "😀";\n'.repeat(5000);
    c.recent = [
      {
        id: "read-1",
        tool: "workspace.read",
        status: "SUCCEEDED",
        projectId: "project-1",
        outcome: {
          summary: "Read index.html",
          evidence: {
            path: "index.html",
            content,
            offset: 2000,
            nextOffset: 2000 + content.length,
            totalCharacters: 150000,
            contentHash: "unchanged-file",
          },
        },
      },
    ];
    const packed = packGeminiContext(c, 32000);
    const slice = JSON.parse(packed.contents).context.recent[0].outcome
      .evidence;
    expect(estimatedInput(packed)).toBeLessThanOrEqual(32000);
    expect(slice.content.length).toBeLessThan(content.length);
    expect(slice.content).toBe(content.slice(0, slice.content.length));
    expect(slice.nextOffset).toBe(2000 + slice.content.length);
    expect(slice.contentHash).toBe("unchanged-file");
    expect(slice.content).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(c.recent[0].outcome).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({ content }),
      }),
    );
  });
  it("rejects an impossible configuration without cutting required permissions or tool schemas", () => {
    expect(() => packGeminiContext(context(), 1000)).toThrow(
      "No inference request was sent",
    );
  });
  it("uses another eligible model when the preferred model cannot fit the input", () => {
    const models = modelCatalog.map((m) => ({
      ...m,
      inputTokenLimit:
        m.id === "gemini-3.5-flash-lite" ? 1000 : m.inputTokenLimit,
    }));
    const task = { ...classifyTask(context()), tier: 1 as const };
    const candidates = rankCandidates(task, models, new Map(), false, 20000);
    expect(candidates[0].id).toBe("gemini-3.8-flash");
    expect(candidates.map((m) => m.id)).not.toContain("gemini-3.5-flash-lite");
    expect(candidates.every((m) => (m.inputTokenLimit ?? 0) >= 20000)).toBe(
      true,
    );
  });
});
