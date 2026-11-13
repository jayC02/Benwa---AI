import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import fs from "node:fs/promises";
import http from "node:http";
import type { Decision } from "../packages/core/src/schema";
import type { Provider } from "../packages/core/src/provider";
import type {
  GeminiTransport,
  Generation,
} from "../packages/core/src/gemini/transport";
let postgres: PGlite, server: PGLiteSocketServer;
let db: (typeof import("../packages/core/src/db"))["db"];
let initialize: (typeof import("../packages/core/src/db"))["initialize"];
let queue: typeof import("../packages/core/src/queue");
let runtime: typeof import("../packages/core/src/runtime");
let providers: typeof import("../packages/core/src/provider");
let finance: typeof import("../packages/core/src/finance");
let cfg: typeof import("../packages/core/src/config");
beforeAll(async () => {
  postgres = await PGlite.create();
  for (const entry of (
    await fs.readdir("prisma/migrations", { withFileTypes: true })
  )
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await postgres.exec(
      await fs.readFile(
        `prisma/migrations/${entry.name}/migration.sql`,
        "utf8",
      ),
    );
  server = new PGLiteSocketServer({
    db: postgres,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 10,
  });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/benwa?connection_limit=1`;
  process.env.AGENT_MODE = "demo";
  process.env.AUTONOMY_MODE = "supervised";
  process.env.WORKSPACE_ROOT = ".data/test-projects";
  ({ db, initialize } = await import("../packages/core/src/db"));
  queue = await import("../packages/core/src/queue");
  runtime = await import("../packages/core/src/runtime");
  providers = await import("../packages/core/src/provider");
  finance = await import("../packages/core/src/finance");
  cfg = await import("../packages/core/src/config");
});
afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await postgres?.close();
});
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "ModelRequest","ModelAccess","ModelCooldown","HumanAssistanceRequest","CreatureState","EmotionSnapshot","AgentConfiguration","Budget","Goal","Project","ProjectMilestone","Task","AgentCycle","Action","ToolExecution","ActionOutcome","Memory","Opportunity","Experiment","FinancialTransaction","SupervisorIntervention","ApprovalRequest","ScheduledJob" CASCADE',
  );
  await initialize();
  await db.creatureState.update({
    where: { id: "benwa" },
    data: { status: "RUNNING" },
  });
});
const project = {
  name: "Test experiment",
  description: "An explicitly unvalidated software experiment",
  hypothesis: {
    revenuePotential: 50,
    confidence: 30,
    cost: 5,
    difficulty: 20,
    validationHours: 2,
    distributionDifficulty: 50,
    competition: 60,
    risk: 20,
    experimentValue: 70,
  },
};
function decision(changes: Partial<Decision> = {}): Decision {
  return {
    projectId: null,
    newProject: project,
    goal: "Validate the usefulness of an inexpensive tool",
    category: "build",
    target: "notes.md",
    intention:
      "Create a real file with a falsifiable customer validation hypothesis",
    rationale: "Preserve a useful artifact before further experimentation",
    strategy: "customer-validation",
    tool: "workspace.write",
    input: {
      path: "notes.md",
      content:
        "# Validation\nInterview five willing potential customers after outreach approval. Stop if none request a trial.\n",
    },
    expectedEvidence: "Read-back hash of the file bytes",
    costEstimateMinor: 0,
    permissions: ["local"],
    thought: "I’m preparing a cheap experiment.",
    ...changes,
  };
}
async function cycle(provider?: Provider) {
  await queue.schedule();
  const job = await queue.claimJob();
  expect(job).not.toBeNull();
  await runtime.runCycle(job!, provider ?? new providers.DemoProvider());
}
describe("Persisted execution, finance and supervision", () => {
  it("independent work defers unavailable external steps without asking or stopping", async () => {
    const original = cfg.env.AUTONOMY_MODE;
    cfg.env.AUTONOMY_MODE = "independent";
    try {
      await cycle(
        new providers.FakeProvider([
          decision({
            tool: "external.request",
            input: {
              kind: "publish",
              description: "Prepare a draft launch for later integration",
              payload: "Draft only",
            },
            permissions: ["publish"],
          }),
        ]),
      );
      expect(await db.approvalRequest.count()).toBe(0);
      expect((await db.action.findFirstOrThrow()).status).toBe("DEFERRED");
      expect(
        (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
          .status,
      ).toBe("RUNNING");
      expect(await db.toolExecution.count()).toBe(0);
      expect(await db.financialTransaction.count()).toBe(0);
      const existing = await db.project.findFirstOrThrow();
      await cycle(
        new providers.FakeProvider([
          decision({
            newProject: null,
            projectId: existing.id,
            intention:
              "Write an independent local prototype with a distinct approach",
            strategy: "local-prototype",
            target: "prototype.md",
          }),
        ]),
      );
      expect(
        await db.actionOutcome.count({ where: { meaningful: true } }),
      ).toBe(1);
      const request = providers.modelRequest(await runtime.buildContext());
      const catalog = JSON.parse(request.messages[1].content) as {
        availableTools: { name: string }[];
      };
      expect(
        catalog.availableTools.some((tool) => tool.name === "external.request"),
      ).toBe(false);
    } finally {
      cfg.env.AUTONOMY_MODE = original;
    }
  });
  it("independent start defers legacy requests without recording consent or losing the project", async () => {
    const { startCreature } = await import("../packages/core/src/control");
    await cycle(
      new providers.FakeProvider([
        decision({
          tool: "external.request",
          input: {
            kind: "publish",
            description: "Prepare a launch for human review",
            payload: "Draft only",
          },
          permissions: ["publish"],
        }),
      ]),
    );
    const original = cfg.env.AUTONOMY_MODE;
    cfg.env.AUTONOMY_MODE = "independent";
    try {
      expect((await startCreature()).pendingReviews).toBe(0);
      const approval = await db.approvalRequest.findFirstOrThrow();
      expect(approval.status).toBe("DEFERRED");
      expect(approval.reviewedAt).toBeNull();
      expect((await db.action.findFirstOrThrow()).status).toBe("DEFERRED");
      expect((await db.project.findFirstOrThrow()).status).toBe("ACTIVE");
      expect((await runtime.buildContext()).projects).toHaveLength(1);
      expect(
        (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
          .status,
      ).toBe("RUNNING");
    } finally {
      cfg.env.AUTONOMY_MODE = original;
    }
  });
  it("independent mode never executes an action that estimates a real charge", async () => {
    const original = cfg.env.AUTONOMY_MODE;
    cfg.env.AUTONOMY_MODE = "independent";
    try {
      await cycle(
        new providers.FakeProvider([decision({ costEstimateMinor: 1 })]),
      );
      expect(await db.toolExecution.count()).toBe(0);
      expect(await db.financialTransaction.count()).toBe(0);
      expect(await db.approvalRequest.count()).toBe(0);
      expect((await db.action.findFirstOrThrow()).status).toBe("DEFERRED");
    } finally {
      cfg.env.AUTONOMY_MODE = original;
    }
  });
  it("starts other local work while leaving a pending launch unapproved", async () => {
    const { startCreature } = await import("../packages/core/src/control");
    await cycle(
      new providers.FakeProvider([
        decision({
          tool: "external.request",
          input: {
            kind: "publish",
            description: "Review a possible launch without publishing anything",
            payload: "Draft launch proposal for human review only",
          },
          permissions: ["publish"],
        }),
      ]),
    );
    const waiting = await db.project.findFirstOrThrow();
    const emotions = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    expect((await startCreature()).pendingReviews).toBe(1);
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("RUNNING");
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .mood,
    ).toBe(emotions.mood);
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: waiting.id } }))
        .status,
    ).toBe("AWAITING_APPROVAL");
    expect(
      await db.approvalRequest.count({ where: { status: "PENDING" } }),
    ).toBe(1);
    expect(
      await db.approvalRequest.count({ where: { status: "APPROVED" } }),
    ).toBe(0);
    expect((await runtime.buildContext()).projects).toHaveLength(0);
    expect(
      await db.scheduledJob.count({
        where: { key: "creature-cycle", status: "PENDING" },
      }),
    ).toBe(1);
    await cycle(new providers.FakeProvider([decision()]));
    expect(await db.project.count()).toBe(2);
    expect(await db.actionOutcome.count({ where: { verified: true } })).toBe(1);
    expect(
      await db.toolExecution.count({
        where: { action: { tool: "external.request" } },
      }),
    ).toBe(0);
    expect(await db.financialTransaction.count()).toBe(0);
    expect(
      await db.approvalRequest.count({ where: { status: "PENDING" } }),
    ).toBe(1);
  });
  it("keeps the project limit when every slot is waiting for review", async () => {
    const { startCreature } = await import("../packages/core/src/control");
    await db.agentConfiguration.update({
      where: { id: "main" },
      data: { maxProjects: 1 },
    });
    await cycle(
      new providers.FakeProvider([
        decision({
          tool: "external.request",
          input: {
            kind: "publish",
            description: "Review a possible launch without publishing anything",
            payload: "Draft launch proposal for human review only",
          },
          permissions: ["publish"],
        }),
      ]),
    );
    await expect(startCreature()).rejects.toThrow(
      "All project slots are waiting for review",
    );
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("WAITING_APPROVAL");
    expect(
      await db.approvalRequest.count({ where: { status: "PENDING" } }),
    ).toBe(1);
    expect(
      await db.scheduledJob.count({
        where: { key: "creature-cycle", status: "PENDING" },
      }),
    ).toBe(0);
  });
  it("does not let a model act on a project whose launch still needs review", async () => {
    const { startCreature } = await import("../packages/core/src/control");
    await cycle(
      new providers.FakeProvider([
        decision({
          tool: "external.request",
          input: {
            kind: "publish",
            description: "Review a possible launch without publishing anything",
            payload: "Draft launch proposal for human review only",
          },
          permissions: ["publish"],
        }),
      ]),
    );
    const waiting = await db.project.findFirstOrThrow();
    await startCreature();
    // Even a manual reactivation cannot bypass the pending-request check.
    await db.project.update({
      where: { id: waiting.id },
      data: { status: "ACTIVE" },
    });
    expect((await runtime.buildContext()).projects).toHaveLength(0);
    await cycle(
      new providers.FakeProvider([
        decision({ newProject: null, projectId: waiting.id }),
      ]),
    );
    expect(await db.toolExecution.count()).toBe(0);
    expect(await db.action.count()).toBe(1);
    expect(
      await db.approvalRequest.count({ where: { status: "PENDING" } }),
    ).toBe(1);
  });
  it("independently blocks excessive project cost per verified outcome", async () => {
    const { monitor } = await import("../packages/core/src/monitor");
    const p = await db.project.create({
      data: {
        name: "Costly experiment",
        description: "A cost attribution test",
        hypothesis: {},
      },
    });
    await finance.recordTransaction(
      {
        externalId: "hosting-expense-1",
        kind: "HOSTING",
        amountMinor: "2000",
        currency: "GBP",
        source: "human",
        projectId: p.id,
        evidence: { reference: "Verified project hosting invoice abc123" },
      },
      "authenticated-human",
    );
    await monitor();
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("SUSPENDED");
  });
  it("independently suspends timed-out projects and requests review across failed strategies", async () => {
    const { monitor } = await import("../packages/core/src/monitor");
    for (let i = 0; i < 2; i++)
      await db.project.create({
        data: {
          name: `Stale ${i}`,
          description: "A deliberately stagnant integration-test project",
          hypothesis: {},
          stagnantAttempts: 3,
          progressAt: new Date(Date.now() - 7200000),
        },
      });
    await monitor();
    expect(await db.project.count({ where: { status: "SUSPENDED" } })).toBe(2);
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("REVIEW_REQUIRED");
    expect(await db.supervisorIntervention.count({ where: { level: 4 } })).toBe(
      1,
    );
  });
  it("uses the real HTTP tool-calling adapter, accounts usage, and executes a verified action", async () => {
    let received: Record<string, unknown> | undefined;
    const model = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received = JSON.parse(body);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "choose_action",
                      arguments: JSON.stringify(decision()),
                    },
                  },
                ],
              },
            },
          ],
          usage: { total_tokens: 321 },
        }),
      );
    });
    await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
    const address = model.address();
    if (!address || typeof address === "string")
      throw new Error("No test model port");
    const originalBase = cfg.env.LLM_BASE_URL,
      originalKey = cfg.env.LLM_API_KEY;
    cfg.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    cfg.env.LLM_API_KEY = "integration-test-key";
    try {
      await cycle(new providers.OpenAICompatibleProvider());
      expect(received?.tool_choice).toEqual({
        type: "function",
        function: { name: "choose_action" },
      });
      expect(await db.actionOutcome.count({ where: { verified: true } })).toBe(
        1,
      );
      const budget = await db.budget.findFirstOrThrow();
      expect(budget.tokensUsed).toBe(321);
      expect(budget.tokensReserved).toBe(321);
    } finally {
      cfg.env.LLM_BASE_URL = originalBase;
      cfg.env.LLM_API_KEY = originalKey;
      await new Promise<void>((resolve) => model.close(() => resolve()));
    }
  });
  it("completes a real file research/build/inspect demo workflow without invented revenue", async () => {
    await db.agentConfiguration.update({
      where: { id: "main" },
      data: { maxSteps: 100 },
    });
    for (let i = 0; i < 12; i++) await cycle();
    const state = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    expect(state.status).toBe("WAITING_APPROVAL");
    const p = await db.project.findFirstOrThrow();
    expect(p.stage).toBe("TESTING");
    expect(
      await fs.readFile(`${cfg.workspaceRoot}/${p.id}/index.html`, "utf8"),
    ).toContain("Math.ceil");
    expect(
      await db.actionOutcome.count({ where: { meaningful: true } }),
    ).toBeGreaterThan(7);
    expect(
      await db.actionOutcome.count({ where: { simulated: true } }),
    ).toBeGreaterThan(0);
    expect((await finance.financialSummary()).revenue).toBe(0n);
    expect(
      await db.approvalRequest.count({ where: { status: "PENDING" } }),
    ).toBe(1);
    expect(await db.emotionSnapshot.count()).toBeGreaterThan(8);
  });
  it("keeps memory and unfinished checkpoint state after a client restart", async () => {
    await cycle(new providers.FakeProvider([decision()]));
    const before = await db.memory.findMany();
    expect(before.length).toBeGreaterThan(0);
    await db.$disconnect();
    expect((await db.memory.findMany()).map((m) => m.id)).toEqual(
      before.map((m) => m.id),
    );
    const p = await db.project.findFirstOrThrow();
    await cycle(
      new providers.FakeProvider([
        decision({
          newProject: null,
          projectId: p.id,
          tool: "workspace.read",
          input: { path: "notes.md" },
        }),
      ]),
    );
    expect(await db.action.count()).toBe(2);
  });
  it("records a failed tool and continues safely to a different useful action", async () => {
    await cycle(
      new providers.FakeProvider([
        decision({ tool: "workspace.read", input: { path: "missing.md" } }),
      ]),
    );
    expect((await db.action.findFirstOrThrow()).status).toBe("FAILED");
    expect((await db.toolExecution.findFirstOrThrow()).error).toContain(
      "ENOENT",
    );
    const p = await db.project.findFirstOrThrow();
    await cycle(
      new providers.FakeProvider([
        decision({ newProject: null, projectId: p.id }),
      ]),
    );
    expect(await db.action.count({ where: { status: "SUCCEEDED" } })).toBe(1);
  });
  it("creates a real warning then blocks a stagnant strategy after three failed attempts", async () => {
    await cycle(
      new providers.FakeProvider([
        decision({
          tool: "workspace.read",
          target: "missing.md",
          input: { path: "missing.md" },
        }),
      ]),
    );
    const p = await db.project.findFirstOrThrow();
    const repeat = decision({
      newProject: null,
      projectId: p.id,
      tool: "workspace.read",
      target: "missing.md",
      input: { path: "missing.md" },
    });
    for (let i = 0; i < 3; i++)
      await cycle(new providers.FakeProvider([repeat]));
    expect(await db.supervisorIntervention.count({ where: { level: 2 } })).toBe(
      1,
    );
    expect(await db.toolExecution.count()).toBe(3);
    await cycle(new providers.FakeProvider([repeat]));
    expect(await db.toolExecution.count()).toBe(3);
  });
  it("allows repeated development actions when each produces new real bytes", async () => {
    await cycle(new providers.FakeProvider([decision()]));
    const p = await db.project.findFirstOrThrow();
    for (let i = 0; i < 3; i++)
      await cycle(
        new providers.FakeProvider([
          decision({
            newProject: null,
            projectId: p.id,
            target: `module-${i}.js`,
            input: {
              path: `module-${i}.js`,
              content: `// Useful independent module number ${i}\nexport function compute${i}(x) { return x * ${i + 2}; }\n`,
            },
          }),
        ]),
      );
    expect(await db.supervisorIntervention.count()).toBe(0);
    expect(await db.actionOutcome.count({ where: { meaningful: true } })).toBe(
      4,
    );
  });
  it("intercepts any positive real cost before tool execution", async () => {
    await cycle(
      new providers.FakeProvider([decision({ costEstimateMinor: 100 })]),
    );
    expect(await db.toolExecution.count()).toBe(0);
    expect(await db.approvalRequest.count()).toBe(1);
    expect(await db.financialTransaction.count()).toBe(0);
  });
  it("rejects fabricated financial claims and keeps the ledger append-only", async () => {
    await expect(
      finance.recordTransaction(
        { kind: "REVENUE", source: "llm", amountMinor: "10000" },
        "authenticated-human",
      ),
    ).rejects.toThrow();
    await finance.recordTransaction(
      {
        externalId: "real-receipt-1",
        kind: "REVENUE",
        amountMinor: "5000",
        currency: "GBP",
        source: "human",
        evidence: { reference: "Bank settlement reference abc123" },
      },
      "authenticated-human",
    );
    await expect(
      db.financialTransaction.updateMany({ data: { amountMinor: 10000n } }),
    ).rejects.toThrow("append-only");
    await finance.recordTransaction(
      {
        externalId: "real-receipt-1",
        kind: "REVENUE",
        amountMinor: "5000",
        currency: "GBP",
        source: "human",
        evidence: { reference: "Bank settlement reference abc123" },
      },
      "authenticated-human",
    );
    expect(await db.financialTransaction.count()).toBe(1);
  });
  it("pauses safely before calling a provider when the daily budget is exhausted", async () => {
    await db.agentConfiguration.update({
      where: { id: "main" },
      data: { dailyTokenLimit: 0 },
    });
    let called = false;
    await cycle({
      name: "openai-compatible",
      decide: async () => {
        called = true;
        return { decision: decision(), tokens: 10 };
      },
    });
    expect(called).toBe(false);
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("BUDGET_PAUSED");
    expect(await db.action.count()).toBe(0);
  });
  it("leases a queued job exactly once and safely reclaims an expired lease", async () => {
    await queue.schedule();
    const [a, b] = await Promise.all([queue.claimJob(), queue.claimJob()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const first = (a ?? b)!;
    await db.scheduledJob.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    const reclaimed = await queue.claimJob();
    expect(reclaimed?.leaseToken).not.toBe(first.leaseToken);
    expect((await queue.finishJob(first, null)).count).toBe(0);
    expect((await queue.finishJob(reclaimed!, null)).count).toBe(1);
  });
  it("replays completed tool evidence after an interruption without duplicating execution", async () => {
    await cycle(new providers.FakeProvider([decision()]));
    const action = await db.action.findFirstOrThrow();
    const job = await db.scheduledJob.findFirstOrThrow();
    await db.actionOutcome.deleteMany();
    await db.emotionSnapshot.deleteMany();
    await db.agentCycle.update({
      where: { id: action.cycleId },
      data: { stage: "VERIFYING" },
    });
    await db.scheduledJob.update({
      where: { id: job.id },
      data: { generation: job.generation - 1 },
    });
    await cycle();
    expect(await db.toolExecution.count()).toBe(1);
    expect(await db.actionOutcome.count()).toBe(1);
  });
  it("recovers energy and wakes without losing persistent state", async () => {
    await db.creatureState.update({
      where: { id: "benwa" },
      data: {
        energy: 10,
        status: "RESTING",
        restStartedAt: new Date(Date.now() - 120000),
        restUntil: new Date(Date.now() - 1000),
      },
    });
    await cycle(new providers.FakeProvider([decision()]));
    const state = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    expect(state.energy).toBeGreaterThan(10);
    expect(state.status).toBe("RUNNING");
  });
  it("returns the dashboard entirely from persisted application data", async () => {
    await cycle(new providers.FakeProvider([decision()]));
    const { snapshot } = await import("../apps/web/src/server/snapshot");
    const view = await snapshot();
    expect(view.creature.name).toBe("Benwa");
    expect(view.actions).toHaveLength(1);
    expect(view.projects[0].name).toBe(project.name);
    expect(view.finance.revenue).toBe(0n);
  });
});

describe("Gemini routing and durable free-tier quotas", () => {
  let routerModule: typeof import("../packages/core/src/gemini/router");
  let quota: typeof import("../packages/core/src/gemini/quota");
  let policy: typeof import("../packages/core/src/gemini/policy");
  let catalog: typeof import("../packages/core/src/gemini/catalog");
  let transportModule: typeof import("../packages/core/src/gemini/transport");
  let saved: {
    key: string;
    project: string;
    confirmed: boolean;
    quotas: string;
  };
  beforeEach(async () => {
    saved = {
      key: cfg.env.GEMINI_API_KEY,
      project: cfg.env.GEMINI_PROJECT_ID,
      confirmed: cfg.env.GEMINI_FREE_TIER_PROJECT_CONFIRMED,
      quotas: cfg.env.GEMINI_QUOTAS_JSON,
    };
    Object.assign(cfg.env, {
      GEMINI_API_KEY: "isolated-test-key",
      GEMINI_PROJECT_ID: "benwa-router-tests",
      GEMINI_FREE_TIER_PROJECT_CONFIRMED: true,
      GEMINI_QUOTAS_JSON: "{}",
    });
    routerModule = await import("../packages/core/src/gemini/router");
    quota = await import("../packages/core/src/gemini/quota");
    policy = await import("../packages/core/src/gemini/policy");
    catalog = await import("../packages/core/src/gemini/catalog");
    transportModule = await import("../packages/core/src/gemini/transport");
  });
  afterEach(() => {
    Object.assign(cfg.env, {
      GEMINI_API_KEY: saved.key,
      GEMINI_PROJECT_ID: saved.project,
      GEMINI_FREE_TIER_PROJECT_CONFIRMED: saved.confirmed,
      GEMINI_QUOTAS_JSON: saved.quotas,
    });
  });
  async function context(complex = false) {
    const p = await db.project.create({
      data: {
        name: complex ? "Complex concurrency algorithm" : "Ordinary experiment",
        description: "An isolated router test project",
        hypothesis: {},
      },
    });
    return {
      state: { name: "Benwa" },
      guidance: [],
      projects: [
        {
          ...p,
          tasks: [
            {
              id: "task-a",
              title: complex
                ? "Debug a complex concurrent algorithm"
                : "Review a public reference",
              status: "PENDING",
            },
          ],
          goals: [],
        },
      ],
      memories: [],
      recent: [],
      restrictions: [],
      portfolio: "Focused test",
      approvedHosts: "none",
      financial: { revenue: 0 },
    } as import("../packages/core/src/provider").AgentContext;
  }
  async function ready(
    ids = [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-4-hydrogen",
    ],
  ) {
    for (const id of ids)
      await db.modelAccess.create({
        data: {
          scope: cfg.env.GEMINI_PROJECT_ID,
          modelId: id,
          credentialFingerprint: quota.credentialFingerprint(),
          status: "READY",
          capabilities: ["tools", "structured", "text"],
          verifiedAt: new Date(),
          metadataAt: new Date(),
        },
      });
  }
  function fake(
    projectId: string,
    run?: (id: string) => Promise<Generation>,
  ): GeminiTransport {
    return {
      metadata: async () => ({ actions: ["generateContent"] }),
      generate:
        run ??
        (async () => {
          const d = decision({ newProject: null, projectId });
          return {
            calls: [
              {
                name: "choose_action",
                args: { ...d, input: JSON.stringify(d.input) },
              },
            ],
            usage: { input: 100, output: 50, total: 150 },
          };
        }),
      text: async () => ({
        calls: [],
        text: "A concise unverified memory summary.",
        usage: { input: 30, output: 10, total: 40 },
      }),
    };
  }
  it("keeps routine actions on Lite and selects Hydrogen for genuinely complex work", async () => {
    await ready();
    const routine = await context();
    const one = await new routerModule.GeminiRouter(
      fake(routine.projects[0].id),
    ).decide(routine);
    expect(one.modelId).toBe("gemini-3.5-flash-lite");
    const advanced = await context(true);
    const two = await new routerModule.GeminiRouter(
      fake(advanced.projects[0].id),
    ).decide(advanced);
    expect(two.modelId).toBe("gemini-4-hydrogen");
    expect((await db.budget.findFirstOrThrow()).tokensUsed).toBe(300);
  });
  it("does not escalate missing infrastructure or a single failed action to Hydrogen", async () => {
    const c = await context();
    c.recent = [
      {
        id: "a",
        projectId: c.projects[0].id,
        tool: "sandbox.run",
        status: "FAILED",
        outcome: { summary: "Sandbox unavailable. Install Docker." },
      },
      {
        id: "b",
        projectId: c.projects[0].id,
        tool: "sandbox.run",
        status: "FAILED",
        outcome: { summary: "Sandbox unavailable. Install Docker." },
      },
    ];
    expect(policy.classifyTask(c).tier).toBe(1);
    const complex = await context(true);
    complex.recent = c.recent.map((action) => ({
      ...action,
      projectId: complex.projects[0].id,
    }));
    expect(policy.classifyTask(complex).tier).toBe(1);
    c.recent = c.recent.slice(0, 1);
    c.recent[0].outcome = { summary: "Assertion test failed" };
    expect(policy.classifyTask(c).tier).toBe(1);
  });
  it("keeps simple housekeeping in a complex project on everyday intelligence", async () => {
    const c = await context(true);
    c.projects[0].tasks = [
      {
        id: "simple-task",
        status: "PENDING",
        title: "Fix a typo in concurrency notes",
      },
    ];
    expect(policy.classifyTask(c).tier).toBe(1);
  });
  it("only escalates persistent reasoning failures after strategy intervention", async () => {
    const c = await context();
    c.recent = ["a", "b"].map((id) => ({
      id,
      projectId: c.projects[0].id,
      tool: "sandbox.run",
      status: "FAILED",
      outcome: { summary: "Assertion test failed: incorrect algorithm" },
    }));
    expect(policy.classifyTask(c).tier).toBe(2);
    c.restrictions = [{ projectId: c.projects[0].id, level: 2 }];
    expect(policy.classifyTask(c).tier).toBe(3);
  });
  it("falls back after a model-scoped 429 without repeatedly calling the exhausted model", async () => {
    await ready();
    const c = await context(),
      calls: string[] = [];
    const normal = fake(c.projects[0].id);
    const transport = fake(c.projects[0].id, async (id) => {
      calls.push(id);
      if (id === "gemini-3.5-flash-lite")
        throw new transportModule.GeminiFailure(
          429,
          new Date(Date.now() + 120000),
          false,
          false,
        );
      return normal.generate(id, transportModule.geminiPayload(c), 2400);
    });
    const result = await new routerModule.GeminiRouter(transport).decide(c);
    expect(result.modelId).toBe("gemini-3.1-flash-lite");
    expect(calls).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    expect(
      await db.modelRequest.count({ where: { status: "RATE_LIMITED" } }),
    ).toBe(1);
  });
  it("honours a shared quota failure across models instead of adding their allowances", async () => {
    await ready();
    const c = await context();
    let calls = 0;
    const transport = fake(c.projects[0].id, async () => {
      calls++;
      throw new transportModule.GeminiFailure(
        429,
        new Date(Date.now() + 120000),
        true,
        false,
      );
    });
    await expect(
      new routerModule.GeminiRouter(transport).decide(c),
    ).rejects.toBeInstanceOf(providers.ProviderWaitError);
    expect(calls).toBe(1);
    expect(
      await db.modelCooldown.count({ where: { key: "generation-project" } }),
    ).toBe(1);
  });
  it("atomically enforces shared rolling limits for concurrent reservations", async () => {
    await ready();
    cfg.env.GEMINI_QUOTAS_JSON = JSON.stringify({
      groups: { "generation-project": { rpm: 1, tpm: 250000, rpd: 500 } },
    });
    const task = policy.classifyTask(await context());
    const attempts = await Promise.allSettled(
      ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].map((modelId) =>
        quota.reserveModelRequest({
          modelId,
          task,
          estimatedInput: 100,
          maxOutput: 100,
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await db.modelRequest.count()).toBe(1);
  });
  it("reserves advanced daily requests for important work", async () => {
    await ready();
    cfg.env.GEMINI_QUOTAS_JSON = JSON.stringify({
      models: { "gemini-4-hydrogen": { rpm: 5, tpm: 250000, rpd: 6 } },
    });
    const c = await context();
    const task = policy.classifyTask(c);
    await quota.reserveModelRequest({
      modelId: "gemini-4-hydrogen",
      task,
      estimatedInput: 1,
      maxOutput: 1,
    });
    await expect(
      quota.reserveModelRequest({
        modelId: "gemini-4-hydrogen",
        task,
        estimatedInput: 1,
        maxOutput: 1,
      }),
    ).rejects.toBeInstanceOf(providers.ProviderWaitError);
    await expect(
      quota.reserveModelRequest({
        modelId: "gemini-4-hydrogen",
        task: { ...task, important: true },
        estimatedInput: 1,
        maxOutput: 1,
      }),
    ).resolves.toBeDefined();
  });
  it("blocks all inference before transport if free billing status is unconfirmed", async () => {
    const c = await context();
    await ready();
    cfg.env.GEMINI_FREE_TIER_PROJECT_CONFIRMED = false;
    let called = false;
    await expect(
      new routerModule.GeminiRouter(
        fake(c.projects[0].id, async () => {
          called = true;
          throw new Error("Must not call");
        }),
      ).decide(c),
    ).rejects.toThrow("unbilled");
    expect(called).toBe(false);
    expect(await db.modelRequest.count()).toBe(0);
  });
  it("enforces the free-project guard at the SDK transport boundary as well", async () => {
    const c = await context(),
      sdk = new transportModule.GoogleGeminiTransport();
    cfg.env.GEMINI_FREE_TIER_PROJECT_CONFIRMED = false;
    await expect(
      sdk.generate(
        "gemini-3.1-flash-lite",
        transportModule.geminiPayload(c),
        128,
      ),
    ).rejects.toThrow("unbilled");
    cfg.env.GEMINI_FREE_TIER_PROJECT_CONFIRMED = true;
    await expect(
      sdk.generate("gemini-4-carbon", transportModule.geminiPayload(c), 128),
    ).rejects.toThrow("Unreviewed");
    expect(await db.modelRequest.count()).toBe(0);
  });
  it("rejects arbitrary paid model identifiers and rotated-key access records", async () => {
    const c = await context();
    await ready();
    await expect(
      quota.reserveModelRequest({
        modelId: "gemini-4-carbon",
        task: policy.classifyTask(c),
        estimatedInput: 1,
        maxOutput: 1,
      }),
    ).rejects.toThrow("Unreviewed");
    cfg.env.GEMINI_API_KEY = "rotated-isolated-test-key";
    await expect(
      new routerModule.GeminiRouter(fake(c.projects[0].id)).decide(c),
    ).rejects.toThrow("No verified free model");
  });
  it("excludes Gemma and specialized endpoints from structured agent decisions", async () => {
    const task = policy.classifyTask(await context());
    const candidates = policy.rankCandidates(
      task,
      [...catalog.modelCatalog],
      new Map(),
      true,
    );
    expect(
      candidates.every(
        (m) =>
          !m.id.startsWith("gemma") &&
          !m.id.includes("embedding") &&
          !m.id.includes("decision"),
      ),
    ).toBe(true);
    const summary = policy.rankCandidates(
      { ...task, kind: "summary", required: ["text"] },
      [...catalog.modelCatalog],
      new Map(),
      true,
    );
    expect(summary.some((m) => m.id.startsWith("gemma"))).toBe(true);
  });
  it("creates a deduplicated detailed help prompt after advanced structured reasoning fails", async () => {
    await ready();
    const c = await context(true);
    const broken = fake(c.projects[0].id, async () => ({
      calls: [],
      usage: { input: 100, output: 20, total: 120 },
    }));
    await expect(
      new routerModule.GeminiRouter(broken).decide(c),
    ).rejects.toBeInstanceOf(providers.AssistanceRequestedError);
    const item = await db.humanAssistanceRequest.findFirstOrThrow();
    expect(item.prompt).toContain("What he has attempted");
    expect(item.prompt).toContain("Successful result");
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: c.projects[0].id } }))
        .status,
    ).toBe("WAITING_ASSISTANCE");
    const assistance = await import("../packages/core/src/gemini/assistance");
    await assistance.requestHumanAssistance(
      c,
      policy.classifyTask(c),
      "Same blocked issue",
    );
    expect(await db.humanAssistanceRequest.count()).toBe(1);
  });
  it("defers a malformed Lite response until cooldown without requesting human help", async () => {
    await ready(["gemini-3.1-flash-lite"]);
    const c = await context();
    const broken = fake(c.projects[0].id, async () => ({
      calls: [],
      usage: { input: 100, output: 20, total: 120 },
    }));
    await expect(
      new routerModule.GeminiRouter(broken).decide(c),
    ).rejects.toBeInstanceOf(providers.ProviderWaitError);
    expect(await db.humanAssistanceRequest.count()).toBe(0);
    expect((await db.project.findFirstOrThrow()).status).toBe("ACTIVE");
    expect((await db.modelRequest.findFirstOrThrow()).status).toBe("INVALID");
  });
  it("falls back from malformed Lite output to verified Flash without using Hydrogen", async () => {
    await ready([
      "gemini-3.1-flash-lite",
      "gemini-3.6-flash",
      "gemini-4-hydrogen",
    ]);
    const c = await context(),
      normal = fake(c.projects[0].id),
      called: string[] = [];
    const transport: GeminiTransport = {
      ...normal,
      generate: async (id, payload, limit, options) => {
        called.push(id);
        return id === "gemini-3.1-flash-lite"
          ? {
              calls: [],
              finishReason: "MAX_TOKENS",
              usage: { input: 100, output: 100, total: 200 },
            }
          : normal.generate(id, payload, limit, options);
      },
    };
    const result = await new routerModule.GeminiRouter(transport).decide(c);
    expect(called).toEqual(["gemini-3.1-flash-lite", "gemini-3.6-flash"]);
    expect(result.selectionReason).toContain("Flash fallback");
    expect(
      (await db.modelRequest.findFirstOrThrow({ where: { status: "INVALID" } }))
        .error,
    ).toContain("Output token limit");
    expect(await db.humanAssistanceRequest.count()).toBe(0);
  });
  it("uses a Flash fallback after locally exhausted everyday quota", async () => {
    await ready([
      "gemini-3.1-flash-lite",
      "gemini-3.6-flash",
      "gemini-4-hydrogen",
    ]);
    cfg.env.GEMINI_QUOTAS_JSON = JSON.stringify({
      models: { "gemini-3.1-flash-lite": { rpm: 15, tpm: 250000, rpd: 0 } },
    });
    const c = await context();
    const result = await new routerModule.GeminiRouter(
      fake(c.projects[0].id),
    ).decide(c);
    expect(result.modelId).toBe("gemini-3.6-flash");
    expect(await db.modelRequest.count()).toBe(1);
    expect((await db.modelRequest.findFirstOrThrow()).reason).toContain(
      "Flash fallback",
    );
  });
  it("keeps Hydrogen excluded from routine fallback and penalizes recent invalid output", async () => {
    const task = policy.classifyTask(await context());
    const candidates = policy.rankCandidates(
      task,
      [...catalog.modelCatalog],
      new Map([["gemini-3.5-flash-lite", { successes: 0, failures: 6 }]]),
    );
    expect(candidates[0].id).toBe("gemini-3.1-flash-lite");
    expect(candidates.some((model) => model.tier === 2)).toBe(true);
    expect(candidates.some((model) => model.tier === 3)).toBe(false);
  });
  async function failedSetup(failures = 1) {
    const checkedAt = new Date(Date.now() - 86400000);
    await db.modelAccess.create({
      data: {
        scope: cfg.env.GEMINI_PROJECT_ID,
        modelId: "gemini-3.5-flash-lite",
        credentialFingerprint: quota.credentialFingerprint(),
        status: "UNVERIFIED",
        capabilities: ["tools", "structured", "text"],
        metadataAt: checkedAt,
        error: "Gemini API HTTP 503 (temporary provider failure)",
      },
    });
    for (let i = 0; i < failures; i++)
      await db.modelRequest.create({
        data: {
          scope: cfg.env.GEMINI_PROJECT_ID,
          modelId: "gemini-3.5-flash-lite",
          operation: "probe",
          tier: 1,
          estimatedInput: 1,
          reservedTokens: 1,
          quotaDay: policy.pacificDay(checkedAt),
          budgetDay: checkedAt.toISOString().slice(0, 10),
          status: "FAILED",
          reason: "Isolated failed setup fixture",
          createdAt: checkedAt,
        },
      });
  }
  it("recovers a temporary setup failure within the decision's bounded attempt allowance", async () => {
    await failedSetup();
    const c = await context(),
      normal = fake(c.projects[0].id);
    const calls: { id: string; probe: boolean }[] = [];
    const transport: GeminiTransport = {
      ...normal,
      generate: async (id, payload, limit, options) => {
        calls.push({ id, probe: Boolean(options?.probe) });
        if (options?.probe)
          expect(JSON.parse(payload.contents).context.projects[0].id).toBe(
            "access-probe",
          );
        return normal.generate(id, payload, limit, options);
      },
    };
    const cycle = await db.agentCycle.create({
      data: { jobId: "bounded-probe", provider: "gemini-router" },
    });
    const result = await new routerModule.GeminiRouter(transport).decide(c, {
      cycleId: cycle.id,
      maxAttempts: 2,
    });
    expect(result.modelId).toBe("gemini-3.5-flash-lite");
    expect(calls).toEqual([
      { id: "gemini-3.5-flash-lite", probe: true },
      { id: "gemini-3.5-flash-lite", probe: false },
    ]);
    expect((await db.modelAccess.findFirstOrThrow()).status).toBe("READY");
  });
  it("backs off automatic capability checks and caps repeated failed probes", async () => {
    await failedSetup(4);
    const verification = await import("../packages/core/src/gemini/verify");
    let calls = 0;
    const transport: GeminiTransport = {
      ...fake("unused"),
      metadata: async () => {
        calls++;
        throw new Error("Must not retry exhausted probes");
      },
    };
    expect(await verification.refreshTemporaryModelAccess(transport, 2)).toBe(
      false,
    );
    expect(calls).toBe(0);
    expect(verification.probeRetryDelay(2)).toBeGreaterThan(
      verification.probeRetryDelay(1),
    );
    expect(verification.probeRetryDelay(100)).toBeLessThanOrEqual(
      catalog.routingPolicy.probeRetryMaximumMs,
    );
  });
  it("does not recheck transient access while a model or shared cooldown is active", async () => {
    await failedSetup();
    await quota.setCooldown(
      "generation-project",
      new Date(Date.now() + 120000),
      "Shared provider cooldown",
    );
    const verification = await import("../packages/core/src/gemini/verify");
    let calls = 0;
    const transport: GeminiTransport = {
      ...fake("unused"),
      metadata: async () => {
        calls++;
        return { actions: ["generateContent"] };
      },
    };
    expect(await verification.refreshTemporaryModelAccess(transport, 2)).toBe(
      false,
    );
    expect(calls).toBe(0);
    expect(await db.modelRequest.count()).toBe(1);
  });
  it("keeps a previously verified model verified after a temporary metadata failure", async () => {
    await ready(["gemini-3.1-flash-lite"]);
    const verification = await import("../packages/core/src/gemini/verify");
    const transport: GeminiTransport = {
      ...fake("unused"),
      metadata: async () => {
        throw new transportModule.GeminiFailure(503, undefined, false, false);
      },
    };
    const [result] = await verification.verifyModels(
      true,
      ["gemini-3.1-flash-lite"],
      transport,
    );
    expect(result.status).toBe("COOLDOWN");
    expect(result.inferenceAttempted).toBe(false);
    expect((await db.modelAccess.findFirstOrThrow()).status).toBe("READY");
    expect(await db.modelCooldown.count()).toBe(1);
  });
  it("records actionable validation diagnostics without storing malformed content", async () => {
    const d = decision(),
      bad = { ...d, input: "{private-invalid-value" };
    try {
      transportModule.parseGeminiDecision(bad);
      throw new Error("Expected parsing to fail");
    } catch (error) {
      const message = transportModule.decisionFailureReason(error);
      expect(message).toContain("valid JSON");
      expect(message).not.toContain("private-invalid-value");
    }
    const failure = transportModule.parseFailure(503, new Headers(), {});
    expect(failure.shared).toBe(false);
    expect(failure.message).toContain("temporary provider failure");
    expect(failure.message).not.toContain("quota");
    try {
      transportModule.parseGeminiDecision({
        ...d,
        input: JSON.stringify(d.input),
        "private-field-value": true,
      });
    } catch (error) {
      expect(transportModule.decisionFailureReason(error)).not.toContain(
        "private-field-value",
      );
    }
  });
  it("keeps unavailable runtime testing on Lite and omits the unusable stage advance", async () => {
    const c = await context(true);
    c.projects[0].stage = "TESTING";
    c.capabilities = {
      sandbox: false,
      web: "public",
      search: "public",
      externalExecution: false,
    };
    expect(policy.classifyTask(c).tier).toBe(1);
    const request = providers.modelRequest(c);
    const tools = (
      JSON.parse(request.messages[1].content) as {
        availableTools: { name: string }[];
      }
    ).availableTools;
    expect(tools.some((tool) => tool.name === "project.advance")).toBe(false);
    expect(tools.some((tool) => tool.name === "research.search")).toBe(true);
  });
  it("preserves ongoing jobs and emotions while deferring a quota-exhausted decision", async () => {
    const initial = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    await cycle({
      name: "gemini-router",
      managesBudget: true,
      decide: async () => {
        throw new providers.ProviderWaitError(
          "Quota exhausted",
          new Date(Date.now() + 60000),
        );
      },
    });
    const state = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    expect(state.status).toBe("QUOTA_PAUSED");
    expect(state.mood).toBe(initial.mood);
    expect((await db.scheduledJob.findFirstOrThrow()).status).toBe("PENDING");
    expect(await db.action.count()).toBe(0);
  });
  it("continues other projects while one waits for human assistance", async () => {
    const c = await context();
    await context();
    const assistance = await import("../packages/core/src/gemini/assistance");
    await cycle({
      name: "gemini-router",
      managesBudget: true,
      decide: async () => {
        await assistance.requestHumanAssistance(
          c,
          policy.classifyTask(c),
          "Advanced diagnosis needs human review",
        );
        throw new providers.AssistanceRequestedError(c.projects[0].id);
      },
    });
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("RUNNING");
    expect(
      (await runtime.buildContext()).projects.every(
        (p) => p.id !== c.projects[0].id,
      ),
    ).toBe(true);
  });
  it("enforces token-per-minute and daily allowances without a model call", async () => {
    await ready();
    const c = await context(),
      task = policy.classifyTask(c);
    cfg.env.GEMINI_QUOTAS_JSON = JSON.stringify({
      models: { "gemini-3.5-flash-lite": { rpm: 15, tpm: 150, rpd: 2 } },
    });
    await quota.reserveModelRequest({
      modelId: "gemini-3.5-flash-lite",
      task,
      estimatedInput: 100,
      maxOutput: 1,
    });
    await expect(
      quota.reserveModelRequest({
        modelId: "gemini-3.5-flash-lite",
        task,
        estimatedInput: 100,
        maxOutput: 1,
      }),
    ).rejects.toBeInstanceOf(providers.ProviderWaitError);
    await db.modelRequest.updateMany({
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await quota.reserveModelRequest({
      modelId: "gemini-3.5-flash-lite",
      task,
      estimatedInput: 100,
      maxOutput: 1,
    });
    await db.modelRequest.updateMany({
      data: { createdAt: new Date(Date.now() - 61000) },
    });
    await expect(
      quota.reserveModelRequest({
        modelId: "gemini-3.5-flash-lite",
        task,
        estimatedInput: 1,
        maxOutput: 1,
      }),
    ).rejects.toThrow("daily allowance");
  });
  it("settles a completed model reservation exactly once across concurrent callbacks", async () => {
    await ready();
    const task = policy.classifyTask(await context());
    const request = await quota.reserveModelRequest({
      modelId: "gemini-3.5-flash-lite",
      task,
      estimatedInput: 1000,
      maxOutput: 1000,
    });
    await Promise.all([
      quota.finishModelRequest(request.id, "SUCCEEDED", {
        input: 100,
        output: 50,
        total: 150,
      }),
      quota.finishModelRequest(request.id, "SUCCEEDED", {
        input: 100,
        output: 50,
        total: 150,
      }),
    ]);
    const budget = await db.budget.findFirstOrThrow();
    expect(budget.tokensReserved).toBe(150);
    expect(budget.tokensUsed).toBe(150);
  });
  it("uses verified Gemma only for opt-in plain text and tracks its actual usage", async () => {
    await ready(["gemma-4-26b-a4b-it"]);
    const c = await context();
    const prior = cfg.env.GEMINI_EXPERIMENTAL_GEMMA;
    cfg.env.GEMINI_EXPERIMENTAL_GEMMA = true;
    try {
      const summary = await new routerModule.GeminiRouter(
        fake(c.projects[0].id),
      ).summarize("Two project tests passed; customer demand is unvalidated.");
      expect(summary.modelId).toBe("gemma-4-26b-a4b-it");
      expect((await db.modelRequest.findFirstOrThrow()).operation).toBe(
        "summary",
      );
      expect((await db.budget.findFirstOrThrow()).tokensUsed).toBe(40);
    } finally {
      cfg.env.GEMINI_EXPERIMENTAL_GEMMA = prior;
    }
  });
  it("saves a reviewed human reply and reactivates its project without connecting accounts", async () => {
    const c = await context();
    const assistance = await import("../packages/core/src/gemini/assistance");
    const item = await assistance.requestHumanAssistance(
      c,
      policy.classifyTask(c),
      "A persistent verification failure needs operator help",
    );
    await db.creatureState.update({
      where: { id: "benwa" },
      data: { status: "WAITING_ASSISTANCE" },
    });
    const api = await import("../apps/web/src/pages/api/[operation]");
    const request = new Request("http://127.0.0.1:4321/api/assistance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        reply:
          "Reproduce with a small test and replace the incorrect calculation before retrying.",
      }),
    });
    const response = await api.POST({
      params: { operation: "assistance" },
      request,
      clientAddress: "127.0.0.1",
    } as unknown as Parameters<typeof api.POST>[0]);
    expect(response.status).toBe(200);
    expect(
      (
        await db.humanAssistanceRequest.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).status,
    ).toBe("RESOLVED");
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: c.projects[0].id } }))
        .status,
    ).toBe("ACTIVE");
    expect(
      (await db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }))
        .status,
    ).toBe("PAUSED");
  });
  it("uses Pacific day resets correctly across daylight saving changes", () => {
    expect(policy.pacificDay(new Date("2026-03-08T07:59:59Z"))).toBe(
      "2026-03-07",
    );
    expect(
      policy
        .nextPacificReset(new Date("2026-03-08T09:00:00Z"))
        .toISOString()
        .slice(0, 16),
    ).toBe("2026-03-09T07:00");
  });
  it("respects Retry-After, RetryInfo and shared scope from provider errors", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const error = transportModule.parseFailure(
      429,
      new Headers({ "retry-after": "120" }),
      {
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "60s",
            },
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaId: "GenerateRequestsPerDayPerProject",
                  quotaDimensions: {},
                },
              ],
            },
          ],
        },
      },
      now,
    );
    expect(error.retryAt?.toISOString()).toBe("2026-11-12T12:02:00.000Z");
    expect(error.shared).toBe(true);
    expect(error.daily).toBe(true);
  });
});
describe("Dashboard snapshot for the house view", () => {
  it("snapshot exposes current cycle, per-project and per-room history, and demo milestones", async () => {
    await db.agentConfiguration.update({
      where: { id: "main" },
      data: { maxSteps: 100 },
    });
    for (let i = 0; i < 6; i++) await cycle();
    const { snapshot } = await import("../apps/web/src/server/snapshot");
    const s = await snapshot();
    const latest = await db.agentCycle.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
    });
    expect(s.cycle?.id).toBe(latest.id);
    const p = await db.project.findFirstOrThrow();
    expect(s.projectHistory[p.id].length).toBeGreaterThanOrEqual(1);
    expect(s.projectHistory[p.id].length).toBeLessThanOrEqual(8);
    expect(s.roomHistory.library.length).toBeGreaterThan(0);
    for (const item of s.roomHistory.library)
      expect(item.tool.startsWith("research.")).toBe(true);
    expect(Object.keys(s.roomHistory).sort()).toEqual([
      "bedroom",
      "hall",
      "journal",
      "library",
      "planning",
      "study",
      "workshop",
    ]);
    const milestones = s.projects.flatMap((x) => x.milestones);
    expect(milestones.length).toBeGreaterThan(0);
    for (const m of milestones) {
      expect(typeof m.simulated).toBe("boolean");
      expect(m).not.toHaveProperty("evidenceAction");
    }
  });
  it("snapshot keeps history for the latest action's project even when it is not ACTIVE", async () => {
    await cycle();
    const p = await db.project.findFirstOrThrow();
    await db.project.update({
      where: { id: p.id },
      data: { status: "AWAITING_APPROVAL" },
    });
    const { snapshot } = await import("../apps/web/src/server/snapshot");
    const s = await snapshot();
    expect(s.actions[0].projectId).toBe(p.id);
    expect(s.projectHistory[p.id]?.length).toBeGreaterThanOrEqual(1);
  });
});

