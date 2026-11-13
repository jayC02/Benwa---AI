import { db } from "./db.js";
import { schedule } from "./queue.js";
import { env } from "./config.js";

/** Start independent work without granting consent to any queued request. */
export async function startCreature() {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const cfg = await tx.agentConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    if (env.AUTONOMY_MODE === "independent") {
      const waiting = await tx.approvalRequest.findMany({
        where: { status: "PENDING" },
        include: { action: true },
      });
      for (const item of waiting) {
        await tx.approvalRequest.update({
          where: { id: item.id },
          data: { status: "DEFERRED", reviewedAt: null },
        });
        await tx.action.update({
          where: { id: item.actionId },
          data: { status: "DEFERRED", completedAt: new Date() },
        });
        await tx.agentCycle.update({
          where: { id: item.action.cycleId },
          data: { stage: "DONE", completedAt: new Date() },
        });
        await tx.project.updateMany({
          where: { id: item.action.projectId, status: "AWAITING_APPROVAL" },
          data: { status: "ACTIVE" },
        });
      }
      if (waiting.length)
        await tx.memory.create({
          data: {
            category: "episodic",
            content: `Independent work enabled by the operator. Deferred ${waiting.length} external request(s): no publication, outreach or spending executor is connected. Consent was not granted. Continue public research, local builds and testing.`,
            verified: true,
            importance: 0.8,
          },
        });
    }
    const pending = await tx.approvalRequest.findMany({
      where: { status: "PENDING" },
      select: { action: { select: { projectId: true } } },
    });
    if (pending.length) {
      await tx.project.updateMany({
        where: {
          id: { in: pending.map((item) => item.action.projectId) },
          status: "ACTIVE",
        },
        data: { status: "AWAITING_APPROVAL" },
      });
      const active = await tx.project.count({ where: { status: "ACTIVE" } });
      const occupied = await tx.project.count({
        where: {
          status: { in: ["ACTIVE", "AWAITING_APPROVAL", "WAITING_ASSISTANCE"] },
        },
      });
      if (!active && occupied >= cfg.maxProjects)
        throw new Error(
          "All project slots are waiting for review. Review a pending request or suspend a waiting project before starting.",
        );
    }
    await tx.creatureState.update({
      where: { id: "benwa" },
      data: {
        status: "RUNNING",
        activeCycles: 0,
        restUntil: null,
        restStartedAt: null,
        activity: pending.length
          ? "Choosing other work while your review is pending"
          : "Choosing the next useful action",
      },
    });
    await schedule(new Date(), tx);
    return { pendingReviews: pending.length };
  });
}
