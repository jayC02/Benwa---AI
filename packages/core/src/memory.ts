import { db } from "./db.js";
import { similarity } from "./supervisor.js";
import { env } from "./config.js";
export async function retrieveMemory(
  projectId?: string,
  query = "commercial progress demand experiments",
) {
  const candidates = await db.memory.findMany({
    where: projectId
      ? {
          OR: [
            { projectId },
            { category: "self-model" },
            { category: "semantic" },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const superseded = new Set(
    candidates.map((m) => m.supersedesId).filter(Boolean),
  );
  return candidates
    .filter((m) => !superseded.has(m.id))
    .map((m) => ({
      m,
      score:
        m.importance +
        similarity(m.content, query) +
        (m.verified ? 0.2 : 0) +
        Math.max(
          0,
          0.2 - ((Date.now() - m.createdAt.getTime()) / 86400000) * 0.01,
        ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ m }) => m);
}
export async function consolidateMemory() {
  const actions = await db.action.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { outcome: true },
  });
  if (!actions.length) return;
  const summary = `Last ${actions.length} recorded actions: ${actions.filter((a) => a.outcome?.meaningful).length} verified novel outcomes; ${actions.filter((a) => a.status === "FAILED").length} failures. ${actions.filter((a) => a.tool.startsWith("research.") && a.outcome?.meaningful).length} source findings. Demand and revenue require independent evidence. Prefer early validation over repeated planning.`;
  const existing = await db.memory.findFirst({
    where: { category: "self-model" },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.content === summary) return;
  await db.memory.create({
    data: {
      category: "self-model",
      content: summary,
      verified: true,
      importance: 0.9,
      supersedesId: existing?.id,
    },
  });
  // Keep the deterministic self-model authoritative; optional prose is a separate belief.
  if (env.LLM_PROVIDER === "gemini" && env.GEMINI_EXPERIMENTAL_GEMMA) {
    const mode = await db.agentConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    if (mode.mode === "real")
      try {
        const { GeminiRouter } = await import("./gemini/router.js");
        const compressed = await new GeminiRouter().summarize(summary);
        await db.memory.create({
          data: {
            category: "semantic",
            content: `Unverified ${compressed.modelId} summary: ${compressed.text}`,
            verified: false,
            importance: 0.4,
          },
        });
      } catch {
        /* Optional compression must not block rest/wake or replace facts. */
      }
  }
}
