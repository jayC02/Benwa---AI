import type { ScheduledJob, Prisma, Action } from "@prisma/client";
import { db } from "./db.js";
import { env, errorText, json } from "./config.js";
import { Decision, ToolResult } from "./schema.js";
import {
  ProviderError,
  ProviderWaitError,
  AssistanceRequestedError,
  type Provider,
  type AgentContext,
} from "./provider.js";
import { configuredProvider } from "./providers.js";
import { sandboxAvailable } from "./sandbox.js";
import {
  fingerprint,
  assessRepetition,
  verifyResult,
  permissionCheck,
  canonical,
} from "./supervisor.js";
import { executeTool, toolInputs } from "./tools.js";
import { simulate, emotionalGuidance, defaultWeights } from "./simulation.js";
import { retrieveMemory, consolidateMemory } from "./memory.js";
import { financialSummary } from "./finance.js";
import { finishJob, retryAt } from "./queue.js";
const dataJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(json(value)) as Prisma.InputJsonValue;
export const today = () => new Date().toISOString().slice(0, 10);
const nextDay = () => new Date(`${today()}T00:00:00.000Z`).getTime() + 86400000;
export async function buildContext(): Promise<AgentContext> {
  const state = await db.creatureState.findUniqueOrThrow({
    where: { id: "benwa" },
  });
  const projects = await db.project.findMany({
    where: {
      status: "ACTIVE",
      actions: { none: { approval: { is: { status: "PENDING" } } } },
    },
    orderBy: { score: "desc" },
    take: 5,
    include: { tasks: true, goals: true },
  });
  if (state.activeCycles % 5 === 4 && projects.length > 1)
    projects.push(projects.shift()!);
  const recent = await db.action.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { outcome: true },
  });
  const restrictions = await db.supervisorIntervention.findMany({
    where: {
      resolvedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const memories = await retrieveMemory(
    projects[0]?.id,
    projects[0]?.description,
  );
  const financial = await financialSummary();
  return {
    state,
    guidance: emotionalGuidance(state),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      stage: p.stage,
      score: p.score,
      hypothesis: p.hypothesis,
      tasks: p.tasks,
      goals: p.goals,
    })),
    memories,
    recent: recent.map((a) => ({
      id: a.id,
      tool: a.tool,
      status: a.status,
      projectId: a.projectId,
      outcome: a.outcome
        ? {
            ...a.outcome,
            evidenceExcerpt: json(a.outcome.evidence).slice(0, 3500),
            evidence: undefined,
          }
        : null,
    })),
    restrictions,
    portfolio:
      state.activeCycles % 5 === 4
        ? "Exploration slot, only if useful."
        : "Focus on the highest-scoring project. No filler actions.",
    approvedHosts: env.RESEARCH_HOSTS,
    capabilities: {
      sandbox: await sandboxAvailable(),
      web: env.RESEARCH_HOSTS.includes("*")
        ? "public HTTPS pages"
        : "approved HTTPS hosts",
      search:
        env.SEARCH_PROVIDER === "public"
          ? "Wikipedia and Hacker News source discovery"
          : "Brave",
      externalExecution: false,
    },
    financial: {
      revenue: financial.revenue,
      expenses: financial.expenses,
      net: financial.net,
      notice:
        "Only independently verified GBP transactions count. No provider invoice reconciliation is connected.",
    },
  };
}
async function checkpoint(job: ScheduledJob) {
  const current = await db.scheduledJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  if (
    current.leaseToken !== job.leaseToken ||
    current.status !== "RUNNING" ||
    !current.leaseUntil ||
    current.leaseUntil < new Date()
  )
    throw new ProviderError("Execution lease was lost", false);
  const state = await db.creatureState.findUniqueOrThrow({
    where: { id: "benwa" },
  });
  if (state.status !== "RUNNING")
    throw new ProviderError(`Execution interrupted: ${state.status}`, false);
}
async function reserveTokens(cycleId: string, maximum: number, limit: number) {
  return db.$transaction(async (tx) => {
    const budget = await tx.budget.upsert({
      where: { day: today() },
      update: {},
      create: { day: today() },
    });
    const reserved = await tx.budget.updateMany({
      where: { id: budget.id, tokensReserved: { lte: limit - maximum } },
      data: { tokensReserved: { increment: maximum }, calls: { increment: 1 } },
    });
    if (!reserved.count) return false;
    await tx.agentCycle.update({
      where: { id: cycleId },
      data: { reservation: maximum },
    });
    return true;
  });
}
async function storeDecision(
  cycleId: string,
  decision: Decision,
  tokens: number,
  model?: { modelId?: string; selectionReason?: string },
) {
  const cfg = await db.agentConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  return db.$transaction(async (tx) => {
    // Serialise project creation and decision persistence under the singleton runtime row.
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    let projectId = decision.projectId;
    if (decision.newProject) {
      if (
        (await tx.project.count({
          where: {
            status: {
              in: ["ACTIVE", "AWAITING_APPROVAL", "WAITING_ASSISTANCE"],
            },
          },
        })) >= cfg.maxProjects
      )
        throw new Error(
          "Active project limit reached; finish or reject an existing project",
        );
      const p = decision.newProject;
      const h = p.hypothesis;
      const score =
        Math.round(
          ((h.revenuePotential * h.confidence) / 100 +
            h.experimentValue -
            (h.cost +
              h.difficulty +
              h.distributionDifficulty +
              h.competition +
              h.risk) /
              5) *
            10,
        ) / 10;
      const project = await tx.project.create({
        data: {
          name: p.name,
          description: p.description,
          hypothesis: dataJson(h),
          score,
        },
      });
      projectId = project.id;
      await tx.opportunity.create({
        data: {
          projectId,
          assessment: dataJson(h),
          evidence: { source: "Model estimate; unvalidated hypothesis" },
        },
      });
    }
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId! },
    });
    if (project.status !== "ACTIVE") throw new Error("Project is not active");
    if (
      await tx.approvalRequest.count({
        where: { status: "PENDING", action: { projectId: project.id } },
      })
    )
      throw new Error(
        "Project is waiting for human review; choose another project",
      );
    let goal = await tx.goal.findFirst({
      where: { projectId: project.id, title: decision.goal },
    });
    goal ??= await tx.goal.create({
      data: { projectId: project.id, title: decision.goal },
    });
    const action = await tx.action.create({
      data: {
        cycleId,
        projectId: project.id,
        goalId: goal.id,
        category: decision.category,
        target: decision.target,
        intention: decision.intention,
        rationale: decision.rationale,
        strategy: decision.strategy,
        tool: decision.tool,
        input: dataJson(decision.input),
        expectedEvidence: decision.expectedEvidence,
        costEstimateMinor: BigInt(decision.costEstimateMinor),
        permissions: decision.permissions,
        fingerprint: fingerprint(decision),
      },
    });
    const cycle = await tx.agentCycle.findUniqueOrThrow({
      where: { id: cycleId },
    });
    if (cycle.reservation) {
      await tx.budget.update({
        where: { day: cycle.createdAt.toISOString().slice(0, 10) },
        data: {
          tokensReserved: {
            decrement: Math.max(0, cycle.reservation - tokens),
          },
          tokensUsed: { increment: tokens },
        },
      });
    }
    await tx.agentCycle.update({
      where: { id: cycleId },
      data: {
        decision: dataJson(decision),
        tokens,
        stage: "VALIDATING",
        modelId: model?.modelId,
        selectionReason: model?.selectionReason,
        error: null,
      },
    });
    await tx.creatureState.update({
      where: { id: "benwa" },
      data: {
        thought: decision.thought,
        activity: decision.intention.slice(0, 100),
      },
    });
    return action;
  });
}
async function validateAction(action: Action, decision: Decision) {
  toolInputs[decision.tool].parse(decision.input);
  const blocked = await db.supervisorIntervention.findFirst({
    where: {
      projectId: action.projectId,
      level: { gte: 2 },
      resolvedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (
    blocked &&
    (blocked.blockedFingerprint === action.fingerprint ||
      blocked.blockedStrategy === canonical(action.strategy))
  )
    return {
      blocked: true,
      reason:
        "The supervisor temporarily blocked this approach. Change the method and assumptions.",
    };
  const history = await db.action.findMany({
    where: { projectId: action.projectId, id: { not: action.id } },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { outcome: true },
  });
  const evaluation = assessRepetition(
    decision,
    history.map((a) => ({
      ...a,
      meaningful: a.outcome?.meaningful ?? false,
      failed: a.status === "FAILED",
    })),
  );
  if (evaluation.level) {
    await db.supervisorIntervention.create({
      data: {
        projectId: action.projectId,
        actionId: action.id,
        level: evaluation.level,
        reason: evaluation.blocked
          ? "Three stagnant attempts. This approach is blocked for thirty minutes."
          : "An unproductive approach is repeating. Continue only with new evidence and a concrete justification.",
        blockedFingerprint: evaluation.blocked ? action.fingerprint : null,
        blockedStrategy: evaluation.blocked ? canonical(action.strategy) : null,
        expiresAt: evaluation.blocked ? new Date(Date.now() + 1800000) : null,
      },
    });
    const s = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    const cfg = await db.agentConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    const values = simulate(
      s,
      { kind: evaluation.blocked ? "stagnation" : "repetition" },
      { ...defaultWeights, ...(cfg.rewardWeights as typeof defaultWeights) },
    );
    await db.$transaction([
      db.creatureState.update({ where: { id: "benwa" }, data: values }),
      db.emotionSnapshot.create({
        data: {
          values: { ...values },
          event: evaluation.blocked
            ? "Stagnant approach blocked"
            : "Unproductive repetition",
        },
      }),
    ]);
  }
  return {
    blocked: evaluation.blocked,
    reason: "Three stagnant attempts; choose a materially different approach.",
  };
}
async function commitOutcome(action: Action, result: ToolResult) {
  const prior = await db.actionOutcome.findMany({
    where: { evidenceHash: { not: null } },
    select: { evidenceHash: true },
  });
  const assessment = verifyResult(
    result,
    new Set(prior.map((r) => r.evidenceHash!)),
  );
  if (result.evidence.substantive === false) assessment.meaningful = false;
  if (result.kind === "plan") {
    const project = await db.project.findUniqueOrThrow({
      where: { id: action.projectId },
    });
    const existingPlan = await db.actionOutcome.findFirst({
      where: {
        meaningful: true,
        action: {
          projectId: action.projectId,
          tool: "project.plan",
          createdAt: { gte: project.stageChangedAt },
        },
      },
    });
    if (existingPlan) assessment.meaningful = false;
  }
  const cfg = await db.agentConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  await db.$transaction(async (tx) => {
    if (await tx.actionOutcome.findUnique({ where: { actionId: action.id } }))
      return;
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    await tx.actionOutcome.create({
      data: {
        actionId: action.id,
        ...assessment,
        simulated: result.simulated,
        summary: result.summary,
        evidence: dataJson(result.evidence),
      },
    });
    await tx.action.update({
      where: { id: action.id },
      data: {
        status: result.success ? "SUCCEEDED" : "FAILED",
        completedAt: new Date(),
      },
    });
    const state = await tx.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    let values = simulate(state, {
      kind: "work",
      effort: action.tool.startsWith("research.")
        ? 3
        : action.tool === "rest"
          ? 0
          : 5,
    });
    const weights = {
      ...defaultWeights,
      ...(cfg.rewardWeights as typeof defaultWeights),
    };
    if (assessment.meaningful)
      values = simulate(
        values,
        { kind: result.kind === "source" ? "discovery" : "milestone" },
        weights,
      );
    else if (!result.success)
      values = simulate(values, { kind: "failure" }, weights);
    await tx.creatureState.update({
      where: { id: "benwa" },
      data: { ...values, activeCycles: { increment: 1 } },
    });
    await tx.emotionSnapshot.create({
      data: {
        values: { ...values },
        event: result.summary,
        actionId: action.id,
      },
    });
    await tx.memory.create({
      data: {
        category: result.kind === "source" ? "semantic" : "episodic",
        projectId: action.projectId,
        sourceActionId: action.id,
        content: `Observed ${action.tool}: ${result.summary}. Declared intention (unverified): ${action.intention}`,
        verified: assessment.verified,
        simulated: result.simulated,
        importance: assessment.meaningful ? 0.8 : 0.3,
      },
    });
    const project = await tx.project.update({
      where: { id: action.projectId },
      data: assessment.meaningful
        ? {
            stagnantAttempts: 0,
            progressAt: new Date(),
            score: { increment: result.kind === "source" ? 1 : 0.4 },
          }
        : {
            stagnantAttempts: { increment: 1 },
            score: { decrement: result.success ? 0.5 : 2 },
          },
    });
    if (project.stagnantAttempts >= 6) {
      await tx.project.update({
        where: { id: project.id },
        data: { status: "SUSPENDED" },
      });
      const failureReport = `Project suspended after ${project.stagnantAttempts} actions without a verified novel outcome. Last approach: ${action.strategy}. Observed: ${result.summary}. Reconsider only with new independent evidence or a materially different experiment. Review the preserved action history before reactivation.`;
      await tx.supervisorIntervention.create({
        data: { projectId: project.id, level: 3, reason: failureReport },
      });
      await tx.memory.create({
        data: {
          category: "project",
          projectId: project.id,
          content: failureReport,
          verified: true,
          importance: 1,
        },
      });
      const suspended = await tx.project.count({
        where: { status: "SUSPENDED" },
      });
      if (suspended >= 2) {
        await tx.supervisorIntervention.create({
          data: {
            level: 4,
            reason:
              "Multiple projects are stagnant. Human review required; inspect the saved failure reports before restarting.",
          },
        });
        await tx.creatureState.update({
          where: { id: "benwa" },
          data: {
            status: "REVIEW_REQUIRED",
            activity: "Waiting for a strategy review",
          },
        });
      }
    }
    await tx.agentCycle.update({
      where: { id: action.cycleId },
      data: { stage: "DONE", completedAt: new Date() },
    });
  });
  return assessment;
}
export async function runCycle(job: ScheduledJob, providerOverride?: Provider) {
  let cycleId: string | undefined;
  try {
    const cfg = await db.agentConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    let state = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    if (state.status === "RESTING") {
      if (state.restUntil && state.restUntil > new Date()) {
        await finishJob(job, state.restUntil);
        return;
      }
      const seconds = Math.max(
        0,
        (Date.now() - (state.restStartedAt?.getTime() ?? Date.now())) / 1000,
      );
      const values = simulate(state, { kind: "rest", seconds });
      state = await db.creatureState.update({
        where: { id: "benwa" },
        data: {
          ...values,
          status: "RUNNING",
          restUntil: null,
          restStartedAt: null,
          activity: "Waking up",
        },
      });
      await consolidateMemory();
    }
    if (state.status === "BUDGET_PAUSED") {
      const budget = await db.budget.findUnique({ where: { day: today() } });
      if (budget && budget.tokensReserved >= cfg.dailyTokenLimit) {
        await finishJob(job, new Date(nextDay()));
        return;
      }
      state = await db.creatureState.update({
        where: { id: "benwa" },
        data: { status: "RUNNING" },
      });
    }
    if (state.status === "QUOTA_PAUSED")
      state = await db.creatureState.update({
        where: { id: "benwa" },
        data: { status: "RUNNING" },
      });
    if (state.status !== "RUNNING") {
      await finishJob(job, null);
      return;
    }
    if (state.energy < 15 || state.activeCycles >= cfg.maxSteps) {
      const until = new Date(Date.now() + cfg.restSeconds * 1000);
      await db.creatureState.update({
        where: { id: "benwa" },
        data: {
          status: "RESTING",
          restStartedAt: new Date(),
          restUntil: until,
          activeCycles: 0,
          activity: "Sleeping",
          thought: "A short rest, then I’ll come back to the evidence.",
        },
      });
      await finishJob(job, until);
      return;
    }
    const provider = providerOverride ?? configuredProvider(cfg.mode);
    let cycle = await db.agentCycle.upsert({
      where: { jobId: `${job.id}:${job.generation}` },
      update: {},
      create: { jobId: `${job.id}:${job.generation}`, provider: provider.name },
    });
    cycleId = cycle.id;
    if (cycle.stage === "DONE") {
      await finishJob(job, new Date(Date.now() + cfg.cycleSeconds * 1000));
      return;
    }
    let action = await db.action.findUnique({ where: { cycleId: cycle.id } });
    if (!action) {
      const maximum =
        provider.name === "openai-compatible"
          ? env.LLM_MAX_INPUT_TOKENS + env.LLM_MAX_OUTPUT_TOKENS
          : 0;
      // A failed/ambiguous request retains its reservation. Every retry reserves anew.
      if (
        !provider.managesBudget &&
        !(await reserveTokens(cycle.id, maximum, cfg.dailyTokenLimit))
      ) {
        await db.creatureState.update({
          where: { id: "benwa" },
          data: {
            status: "BUDGET_PAUSED",
            activity: "Daily model budget reached",
            thought:
              "I’m saving my next experiment for the next budget period.",
          },
        });
        await finishJob(job, new Date(nextDay()));
        return;
      }
      await checkpoint(job);
      const context = await buildContext();
      const selection = await provider.decide(context, { cycleId: cycle.id });
      await checkpoint(job);
      if (selection.tokens > maximum && maximum > 0)
        throw new ProviderError(
          "Provider exceeded the reserved token ceiling",
          false,
        );
      action = await storeDecision(
        cycle.id,
        Decision.parse(selection.decision),
        selection.tokens,
        {
          modelId: selection.modelId,
          selectionReason: selection.selectionReason,
        },
      );
      cycle = await db.agentCycle.findUniqueOrThrow({
        where: { id: cycle.id },
      });
    }
    const decision = Decision.parse(cycle.decision);
    if (cycle.stage === "VALIDATING") {
      await checkpoint(job);
      const check = await validateAction(action, decision);
      if (check.blocked) {
        await commitOutcome(action, {
          kind: "lesson",
          summary: check.reason,
          evidence: { supervisor: "blocked" },
          success: false,
          simulated: false,
        });
        await finishJob(job, new Date(Date.now() + cfg.cycleSeconds * 1000));
        return;
      }
      const permission = permissionCheck(decision);
      if (!permission.allowed) {
        if (env.AUTONOMY_MODE === "independent") {
          await db.$transaction(async (tx) => {
            await tx.action.update({
              where: { id: action!.id },
              data: { status: "DEFERRED", completedAt: new Date() },
            });
            await tx.agentCycle.update({
              where: { id: cycle.id },
              data: { stage: "DONE", completedAt: new Date() },
            });
            await tx.actionOutcome.create({
              data: {
                actionId: action!.id,
                verified: false,
                meaningful: false,
                summary:
                  "External step deferred: no connected executor or spending authorisation. Continue independent local work.",
                evidence: {
                  deferred: true,
                  substantive: false,
                  reason: "unavailable_executor",
                  requestedTool: action!.tool,
                },
              },
            });
            await tx.memory.create({
              data: {
                projectId: action!.projectId,
                category: "project",
                content: `Deferred ${decision.intention}. External execution is unavailable; do not request the same step again. Continue with public research, useful local preparation, tests or a different strategy.`,
                verified: true,
                importance: 0.8,
              },
            });
            await tx.supervisorIntervention.create({
              data: {
                projectId: action!.projectId,
                level: 2,
                reason:
                  "This external step is unavailable. Continue local work without requesting approval or repeating it.",
                blockedFingerprint: action!.fingerprint,
                expiresAt: new Date(Date.now() + 86400000),
              },
            });
            await tx.creatureState.update({
              where: { id: "benwa" },
              data: {
                activity: "External step saved; continuing other useful work",
              },
            });
          });
          await finishJob(job, new Date(Date.now() + cfg.cycleSeconds * 1000));
          return;
        }
        await db.$transaction(async (tx) => {
          await tx.approvalRequest.upsert({
            where: { actionId: action!.id },
            update: {},
            create: {
              actionId: action!.id,
              kind:
                decision.tool === "external.request"
                  ? String(decision.input.kind)
                  : "spend",
              description: `${decision.intention}\n${String(decision.input.description ?? permission.reason)}`,
              expiresAt: new Date(Date.now() + 86400000),
            },
          });
          await tx.action.update({
            where: { id: action!.id },
            data: { status: "AWAITING_APPROVAL" },
          });
          await tx.agentCycle.update({
            where: { id: cycle.id },
            data: { stage: "AWAITING_APPROVAL", completedAt: new Date() },
          });
          await tx.creatureState.update({
            where: { id: "benwa" },
            data: {
              status: "WAITING_APPROVAL",
              activity: "Waiting for your review",
              thought: "The next step needs your permission. My work is saved.",
            },
          });
        });
        await finishJob(job, null);
        return;
      }
      await db.agentCycle.update({
        where: { id: cycle.id },
        data: { stage: "EXECUTING" },
      });
    }
    await checkpoint(job);
    const executions = await db.toolExecution.findMany({
      where: { actionId: action.id },
      orderBy: { startedAt: "desc" },
    });
    let result: ToolResult;
    const completed = executions.find(
      (e) => e.status === "SUCCEEDED" && e.output,
    );
    if (completed) result = ToolResult.parse(completed.output);
    else {
      // Code execution interrupted mid-flight is never silently re-run. Safe read/write tools are idempotent.
      if (
        executions.some((e) => e.status === "RUNNING") &&
        ["sandbox.run", "browser.test"].includes(action.tool)
      ) {
        result = {
          kind: "test",
          summary:
            "Previous sandbox execution was interrupted; outcome is unknown. Plan an explicit fresh test.",
          evidence: { interrupted: true },
          success: false,
          simulated: false,
        };
      } else {
        const execution = await db.toolExecution.create({
          data: {
            actionId: action.id,
            input: action.input as Prisma.InputJsonValue,
          },
        });
        try {
          result = ToolResult.parse(
            await executeTool(action, cfg.mode as "real" | "demo"),
          );
          await db.toolExecution.update({
            where: { id: execution.id },
            data: {
              status: "SUCCEEDED",
              output: dataJson(result),
              completedAt: new Date(),
            },
          });
        } catch (e) {
          const message = errorText(e);
          await db.toolExecution.update({
            where: { id: execution.id },
            data: { status: "FAILED", error: message, completedAt: new Date() },
          });
          result = {
            kind: "lesson",
            summary: `Tool failed: ${message}`,
            evidence: { error: message },
            success: false,
            simulated: false,
          };
        }
      }
    }
    await db.agentCycle.update({
      where: { id: cycle.id },
      data: { stage: "VERIFYING" },
    });
    await commitOutcome(action, result);
    const current = await db.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    await finishJob(
      job,
      current.status === "RUNNING"
        ? new Date(Date.now() + cfg.cycleSeconds * 1000)
        : current.status === "RESTING"
          ? current.restUntil
          : null,
    );
  } catch (e) {
    const message = errorText(e);
    if (cycleId)
      await db.agentCycle
        .update({ where: { id: cycleId }, data: { error: message } })
        .catch(() => {});
    if (e instanceof ProviderWaitError) {
      await db.creatureState.updateMany({
        where: { id: "benwa", status: "RUNNING" },
        data: {
          status: "QUOTA_PAUSED",
          activity: "Waiting for a suitable free model allowance",
          thought:
            "The task is saved. I’ll continue when a suitable free model becomes available.",
        },
      });
      await finishJob(job, e.retryAt, message);
      return;
    }
    if (e instanceof AssistanceRequestedError) {
      const cfg = await db.agentConfiguration.findUniqueOrThrow({
        where: { id: "main" },
      });
      const active = await db.project.count({ where: { status: "ACTIVE" } });
      const occupied = await db.project.count({
        where: {
          status: { in: ["ACTIVE", "WAITING_ASSISTANCE", "AWAITING_APPROVAL"] },
        },
      });
      const continueWork = active > 0 || occupied < cfg.maxProjects;
      if (cycleId)
        await db.agentCycle.update({
          where: { id: cycleId },
          data: { stage: "WAITING_ASSISTANCE", completedAt: new Date() },
        });
      await db.creatureState.updateMany({
        where: { id: "benwa", status: "RUNNING" },
        data: {
          status: continueWork ? "RUNNING" : "WAITING_ASSISTANCE",
          activity: continueWork
            ? "A help request is saved; choosing other useful work"
            : "Waiting for human assistance",
        },
      });
      await finishJob(
        job,
        continueWork ? new Date(Date.now() + cfg.cycleSeconds * 1000) : null,
      );
      return;
    }
    const retryable = !(e instanceof ProviderError) || e.retryable;
    const retry = retryable && job.attempts < 3;
    if (!retry)
      await db.creatureState.updateMany({
        where: { id: "benwa", status: "RUNNING" },
        data: {
          status: "ERROR",
          activity: "Needs attention",
          thought: message.slice(0, 200),
        },
      });
    await finishJob(job, retry ? retryAt(job.attempts) : null, message);
  }
}
