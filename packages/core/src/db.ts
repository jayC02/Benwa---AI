import { PrismaClient } from "@prisma/client";
import { env } from "./config.js";
import { SkillRatings, emptySkills, applySkillOutcome } from "./skills.js";
const shared = globalThis as typeof globalThis & {
  benwaDatabase?: PrismaClient;
};
export const db =
  shared.benwaDatabase ??
  new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
shared.benwaDatabase = db;
export async function initialize() {
  await db.creatureState.upsert({
    where: { id: "benwa" },
    update: {},
    create: {},
  });
  await db.agentConfiguration.upsert({
    where: { id: "main" },
    update: { mode: env.AGENT_MODE },
    create: { mode: env.AGENT_MODE },
  });
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const state = await tx.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    if (SkillRatings.safeParse(state.skills).success) return;
    // One-time upgrade: derive progress from real saved outcomes, never invented XP.
    const outcomes = await tx.actionOutcome.findMany({
      orderBy: [{ createdAt: "asc" }, { actionId: "asc" }],
      include: { action: true },
    });
    let ratings = emptySkills();
    const previous = new Map<string, { failed: boolean; strategy: string }>();
    for (const outcome of outcomes) {
      const action = outcome.action;
      const prior = previous.get(action.projectId);
      const evidence =
        outcome.evidence &&
        typeof outcome.evidence === "object" &&
        !Array.isArray(outcome.evidence)
          ? outcome.evidence
          : {};
      const feedback =
        evidence.happinessFeedback &&
        typeof evidence.happinessFeedback === "object" &&
        !Array.isArray(evidence.happinessFeedback)
          ? evidence.happinessFeedback
          : undefined;
      const progress =
        outcome.verified &&
        outcome.meaningful &&
        action.tool !== "research.search" &&
        (feedback === undefined || feedback.signal === "positive");
      const failed = action.status === "FAILED";
      const changed = prior?.strategy !== action.strategy;
      ratings = applySkillOutcome(ratings, {
        tool: action.tool,
        target:
          typeof evidence.path === "string" ? evidence.path : action.target,
        progress,
        failed,
        recovered: prior?.failed && changed,
        repeatedFailure: prior?.failed && !changed,
      }).ratings;
      previous.set(action.projectId, { failed, strategy: action.strategy });
    }
    await tx.creatureState.update({
      where: { id: "benwa" },
      data: { skills: ratings },
    });
  });
}
