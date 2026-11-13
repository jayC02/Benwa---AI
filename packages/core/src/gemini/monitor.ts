import { db } from "../db.js";
import { env } from "../config.js";
import { routingConfiguration, modelEnabled } from "./catalog.js";
import { pacificDay } from "./policy.js";
import { credentialFingerprint } from "./quota.js";
export async function modelMonitor() {
  const scope = env.GEMINI_PROJECT_ID;
  const now = new Date();
  const [requests, access, cooldowns, totals] = await Promise.all([
    db.modelRequest.findMany({
      where: { scope, quotaDay: pacificDay(now) },
      orderBy: { createdAt: "desc" },
    }),
    db.modelAccess.findMany({ where: { scope } }),
    db.modelCooldown.findMany({ where: { scope, until: { gt: now } } }),
    db.modelRequest.groupBy({
      by: ["modelId"],
      where: { scope },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
  ]);
  const configuration = routingConfiguration();
  const last = await db.modelRequest.findFirst({
    where: { scope },
    orderBy: { createdAt: "desc" },
  });
  return {
    provider: env.LLM_PROVIDER,
    freeProjectConfirmed: env.GEMINI_FREE_TIER_PROJECT_CONFIRMED,
    quotaLabel:
      "Locally observed requests and configured ceilings, not Google-confirmed remaining quota.",
    currentModel:
      requests.find(
        (r) =>
          r.status === "RESERVED" &&
          now.getTime() - r.createdAt.getTime() < 90000,
      )?.modelId ?? null,
    lastModel: last?.modelId ?? null,
    lastReason: last?.reason ?? null,
    groups: configuration.groups,
    models: configuration.models
      .filter((model) => modelEnabled(model.id))
      .map((model) => {
        const rows = requests.filter((r) => r.modelId === model.id),
          minute = rows.filter(
            (r) => now.getTime() - r.createdAt.getTime() < 60000,
          ),
          status = access.find((a) => a.modelId === model.id),
          total = totals.find((t) => t.modelId === model.id);
        const cooling = cooldowns
          .filter((c) => [model.id, ...model.groups].includes(c.key))
          .sort((a, b) => b.until.getTime() - a.until.getTime())[0];
        return {
          id: model.id,
          label: model.label,
          tier: model.tier,
          status:
            status?.status === "READY" &&
            (status.credentialFingerprint !== credentialFingerprint() ||
              !status.verifiedAt ||
              now.getTime() - status.verifiedAt.getTime() > 7 * 86400000)
              ? "REVERIFY_REQUIRED"
              : (status?.status ?? "UNVERIFIED"),
          accessError: status?.error ?? null,
          note: model.note ?? null,
          routingUse: model.experimental
            ? env.GEMINI_EXPERIMENTAL_GEMMA
              ? "Plain-text summaries only"
              : "Experimental summaries disabled"
            : !model.capabilities.includes("structured")
              ? "Separate endpoint; not used for agent actions"
              : model.tier === 3
                ? "Complex work, strategic reviews and Flash fallback; all daily requests available"
                : model.tier === 2
                  ? "Planning, debugging and everyday fallback"
                  : "Everyday actions",
          capabilities: model.capabilities,
          limits: model.limits,
          reserve: model.reserve,
          requestsToday: rows.length,
          remainingDaily: Math.max(0, model.limits.rpd - rows.length),
          requestsPerMinute: minute.length,
          inputPerMinute: minute.reduce(
            (n, r) => n + (r.inputTokens ?? r.estimatedInput),
            0,
          ),
          totalRequests: total?._count._all ?? 0,
          totalInputTokens: total?._sum.inputTokens ?? 0,
          totalOutputTokens: total?._sum.outputTokens ?? 0,
          failedRequests: rows.filter((r) =>
            ["FAILED", "INVALID", "RATE_LIMITED"].includes(r.status),
          ).length,
          rateLimitFailures: rows.filter((r) => r.status === "RATE_LIMITED")
            .length,
          cooldownUntil: cooling?.until ?? null,
          cooldownReason: cooling?.reason ?? null,
          verifiedAt: status?.verifiedAt ?? null,
        };
      }),
  };
}
