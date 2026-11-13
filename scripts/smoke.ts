import { db, initialize } from "../packages/core/src/db.js";
import { env } from "../packages/core/src/config.js";
import { ProviderError, type Provider } from "../packages/core/src/provider.js";
import { Decision } from "../packages/core/src/schema.js";
import { schedule, claimJob } from "../packages/core/src/queue.js";
import { runCycle } from "../packages/core/src/runtime.js";
import { realProvider } from "../packages/core/src/providers.js";
if (!(env.LLM_PROVIDER === "gemini" ? env.GEMINI_API_KEY : env.LLM_API_KEY)) {
  console.error(
    "SKIPPED: configure the selected provider key for the real-provider smoke test. No model calls were made.",
  );
  process.exit(2);
}
await initialize();
const original = await db.creatureState.findUniqueOrThrow({
  where: { id: "benwa" },
});
if (original.energy < 30)
  throw new Error(
    "Let Benwa finish a rest period before running the smoke test.",
  );
if (original.heartbeat && Date.now() - original.heartbeat.getTime() < 15000)
  throw new Error(
    "Stop the worker process and wait 15 seconds before running this bounded smoke test.",
  );
const configuration = await db.agentConfiguration.findUniqueOrThrow({
  where: { id: "main" },
});
if (configuration.mode !== "real")
  throw new Error("Set AGENT_MODE=real for the live smoke test.");
if (
  (await db.project.count({ where: { status: "ACTIVE" } })) >=
  configuration.maxProjects
)
  throw new Error(
    "Suspend an existing project before adding the smoke experiment.",
  );
const project = await db.project.create({
  data: {
    name: `Real smoke ${new Date().toISOString()}`,
    description:
      "Bounded real-provider research, build and static verification. No publication or expenditure.",
    hypothesis: { smoke: true },
    score: 0,
  },
});
const requirements = [
  {
    tool: "research.fetch",
    input: {
      url:
        process.env.SMOKE_RESEARCH_URL ??
        "https://developer.mozilla.org/en-US/docs/Web/HTML",
    },
    instruction:
      "Retrieve this one approved public HTML implementation reference.",
  },
  {
    tool: "workspace.write",
    instruction:
      "Create smoke.html, a self-contained useful calculator with accessible inputs and no external network calls. Use the source observation as implementation context.",
  },
  {
    tool: "workspace.inspect",
    input: {
      path: "smoke.html",
      contains: ["<html", "<title", "<label", "<script"],
    },
    instruction:
      "Statically inspect the generated artifact. Do not claim a runtime or browser test.",
  },
] as const;
const real = realProvider();
try {
  for (let index = 0; index < requirements.length; index++) {
    const requirement = requirements[index];
    const provider: Provider = {
      name: real.name,
      managesBudget: real.managesBudget,
      decide: async (context, options) => {
        context.projects = context.projects.filter((p) => p.id === project.id);
        context.guidance.push(
          `Smoke step ${index + 1}: ${requirement.instruction} Required tool: ${requirement.tool}. ${"input" in requirement ? `Required input: ${JSON.stringify(requirement.input)}` : "Use path smoke.html."}`,
        );
        const selected = await real.decide(
          context,
          options ? { ...options, maxAttempts: 1 } : undefined,
        );
        const decision = Decision.parse(selected.decision);
        if (
          decision.tool !== requirement.tool ||
          decision.projectId !== project.id ||
          decision.newProject ||
          decision.costEstimateMinor ||
          decision.permissions.some(
            (p) => !["local", "public_read"].includes(p),
          )
        )
          throw new ProviderError(
            "Provider did not select the bounded smoke action. No tool executed.",
            false,
          );
        if (
          "input" in requirement &&
          JSON.stringify(decision.input) !== JSON.stringify(requirement.input)
        )
          throw new ProviderError(
            "Provider changed required smoke inputs",
            false,
          );
        if (
          requirement.tool === "workspace.write" &&
          decision.input.path !== "smoke.html"
        )
          throw new ProviderError("Smoke artifact path differs", false);
        return selected;
      },
    };
    await db.creatureState.update({
      where: { id: "benwa" },
      data: { status: "RUNNING", activeCycles: 0 },
    });
    await schedule();
    const job = await claimJob();
    if (!job)
      throw new Error(
        "Another process owns the job lease. Stop it before testing.",
      );
    await runCycle(job, provider);
    const cycle = await db.agentCycle.findUniqueOrThrow({
      where: { jobId: `${job.id}:${job.generation}` },
      include: { action: { include: { outcome: true } } },
    });
    if (!cycle.action?.outcome?.verified || cycle.error)
      throw new Error(
        cycle.error ??
          cycle.action?.outcome?.summary ??
          "Smoke paused before executing; inspect the model token budget.",
      );
    console.log(`PASS ${index + 1}/3 ${cycle.action.outcome.summary}`);
  }
  console.log(
    `Real-provider smoke passed. Project ${project.id}; at most three model calls, normal budget and supervisor checks, real tools, persisted outcomes. Static verification only.`,
  );
} finally {
  await db.project.update({
    where: { id: project.id },
    data: { status: "SUSPENDED" },
  });
  await db.creatureState.update({
    where: { id: "benwa" },
    data: {
      status: "PAUSED",
      activity: "Real-provider smoke finished; inspect its audit trail",
    },
  });
  await db.$disconnect();
}
