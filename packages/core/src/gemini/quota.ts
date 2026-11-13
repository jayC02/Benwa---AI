import { db } from "../db.js";
import { env } from "../config.js";
import { digest } from "../supervisor.js";
import { ProviderWaitError } from "../provider.js";
import {
  freeProjectGuard,
  routingConfiguration,
  type Limits,
  modelEnabled,
} from "./catalog.js";
import { pacificDay, nextPacificReset, type RoutingTask } from "./policy.js";
export const credentialFingerprint = () => digest(env.GEMINI_API_KEY);
const utcDay = (now: Date) => now.toISOString().slice(0, 10);
export async function reserveModelRequest(input: {
  modelId: string;
  task: RoutingTask;
  estimatedInput: number;
  maxOutput: number;
  cycleId?: string;
  probe?: boolean;
  now?: Date;
}) {
  freeProjectGuard();
  const now = input.now ?? new Date(),
    scope = env.GEMINI_PROJECT_ID;
  const configuration = routingConfiguration(),
    model = configuration.models.find((m) => m.id === input.modelId);
  if (
    !modelEnabled(input.modelId) ||
    !model?.freeStandard ||
    (model.expiresAt && new Date(model.expiresAt) <= now)
  )
    throw new Error("Unreviewed, paid, or retired model is blocked");
  if (
    !Number.isSafeInteger(input.estimatedInput) ||
    input.estimatedInput < 1 ||
    input.estimatedInput > env.LLM_MAX_INPUT_TOKENS ||
    (model.inputTokenLimit !== undefined &&
      input.estimatedInput > model.inputTokenLimit) ||
    !Number.isSafeInteger(input.maxOutput) ||
    input.maxOutput < 1 ||
    input.maxOutput > env.LLM_MAX_OUTPUT_TOKENS
  )
    throw new Error("Invalid model token reservation");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    if (!input.probe) {
      const access = await tx.modelAccess.findUnique({
        where: { scope_modelId: { scope, modelId: model.id } },
      });
      if (
        access?.status !== "READY" ||
        access.credentialFingerprint !== credentialFingerprint() ||
        !access.verifiedAt ||
        now.getTime() - access.verifiedAt.getTime() > 7 * 86400000
      )
        throw new Error(
          `Model ${model.id} needs a successful access/capability probe. Run models:verify -- --probe.`,
        );
    }
    const keys = [model.id, ...model.groups];
    const cooldown = await tx.modelCooldown.findFirst({
      where: { scope, key: { in: keys }, until: { gt: now } },
      orderBy: { until: "desc" },
    });
    if (cooldown)
      throw new ProviderWaitError(
        `Model quota cooldown: ${cooldown.reason}`,
        cooldown.until,
      );
    const day = pacificDay(now),
      minute = new Date(now.getTime() - 60000);
    const usage = await tx.modelRequest.findMany({
      where: { scope, OR: [{ quotaDay: day }, { createdAt: { gte: minute } }] },
      select: {
        modelId: true,
        quotaDay: true,
        createdAt: true,
        inputTokens: true,
        estimatedInput: true,
      },
    });
    function checkLimits(
      limits: Limits,
      ids: string[],
      label: string,
      reserve = 0,
    ) {
      const rows = usage.filter((r) => ids.includes(r.modelId));
      const recent = rows.filter((r) => r.createdAt >= minute);
      if (limits.rpd <= 0 || limits.rpm <= 0 || limits.tpm <= 0)
        throw new ProviderWaitError(
          `No configured free allowance for ${label}`,
          nextPacificReset(now),
        );
      if (
        rows.filter((r) => r.quotaDay === day).length >=
        Math.max(0, limits.rpd - reserve)
      )
        throw new ProviderWaitError(
          `Configured daily allowance reached for ${label}`,
          nextPacificReset(now),
        );
      if (
        recent.length >= limits.rpm ||
        recent.reduce((n, r) => n + (r.inputTokens ?? r.estimatedInput), 0) +
          input.estimatedInput >
          limits.tpm
      ) {
        const until = recent.length
          ? new Date(
              Math.min(...recent.map((r) => r.createdAt.getTime())) + 60001,
            )
          : nextPacificReset(now);
        throw new ProviderWaitError(
          `Configured rolling minute allowance reached for ${label}`,
          until,
        );
      }
    }
    checkLimits(
      model.limits,
      [model.id],
      model.id,
      input.task.important ? 0 : model.reserve,
    );
    for (const key of model.groups)
      checkLimits(
        configuration.groups[key],
        configuration.models
          .filter((m) => m.groups.includes(key))
          .map((m) => m.id),
        key,
      );
    const budget = await tx.budget.upsert({
      where: { day: utcDay(now) },
      update: {},
      create: { day: utcDay(now) },
    });
    const cap = await tx.agentConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    const reservedTokens = input.estimatedInput + input.maxOutput;
    if (budget.tokensReserved + reservedTokens > cap.dailyTokenLimit)
      throw new ProviderWaitError(
        "Benwa daily token budget reached",
        new Date(new Date(`${utcDay(now)}T00:00:00Z`).getTime() + 86400000),
      );
    await tx.budget.update({
      where: { id: budget.id },
      data: {
        tokensReserved: { increment: reservedTokens },
        calls: { increment: 1 },
      },
    });
    return tx.modelRequest.create({
      data: {
        scope,
        modelId: model.id,
        quotaDay: day,
        operation: input.probe ? "probe" : input.task.kind,
        tier: model.tier,
        estimatedInput: input.estimatedInput,
        reservedTokens,
        budgetDay: utcDay(now),
        reason: input.task.reason,
        cycleId: input.cycleId,
        projectId: input.task.projectId,
        issueKey: input.task.issueKey,
        createdAt: now,
      },
    });
  });
}
export async function finishModelRequest(
  id: string,
  status: "SUCCEEDED" | "INVALID" | "FAILED" | "RATE_LIMITED",
  usage?: { input: number; output: number; total: number },
  error?: string,
) {
  if (
    usage &&
    (!Object.values(usage).every((v) => Number.isSafeInteger(v) && v >= 0) ||
      usage.total < usage.input + usage.output)
  )
    throw new Error("Invalid provider token usage");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ModelRequest" WHERE id=${id} FOR UPDATE`;
    const request = await tx.modelRequest.findUniqueOrThrow({ where: { id } });
    if (request.status !== "RESERVED") return;
    await tx.modelRequest.update({
      where: { id },
      data: {
        status,
        inputTokens: usage?.input,
        outputTokens: usage?.output,
        totalTokens: usage?.total,
        error,
        completedAt: new Date(),
      },
    });
    if (usage)
      await tx.budget.update({
        where: { day: request.budgetDay },
        data: {
          tokensReserved: { increment: usage.total - request.reservedTokens },
          tokensUsed: { increment: usage.total },
        },
      });
  });
}
export async function setCooldown(key: string, until: Date, reason: string) {
  const scope = env.GEMINI_PROJECT_ID;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const old = await tx.modelCooldown.findUnique({
      where: { scope_key: { scope, key } },
    });
    await tx.modelCooldown.upsert({
      where: { scope_key: { scope, key } },
      create: { scope, key, until, reason },
      update: {
        until: old && old.until > until ? old.until : until,
        reason,
        failures: { increment: 1 },
      },
    });
  });
}
