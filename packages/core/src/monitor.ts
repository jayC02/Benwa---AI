import { db } from "./db.js";
import { env } from "./config.js";
/** Independent of model calls and cycle execution; also runs in a separate monitor process. */
export async function monitor(
  now = new Date(),
  policy = {
    stagnantSeconds: env.SUPERVISOR_STAGNANT_SECONDS,
    maxCostPerOutcomeMinor: BigInt(env.SUPERVISOR_MAX_COST_PER_OUTCOME_MINOR),
  },
) {
  await db.scheduledJob.upsert({
    where: { key: "supervisor-monitor" },
    update: { status: "MONITORING", runAt: now },
    create: { key: "supervisor-monitor", status: "MONITORING", runAt: now },
  });
  const state = await db.creatureState.findUniqueOrThrow({
    where: { id: "benwa" },
  });
  if (
    state.status === "RUNNING" &&
    state.heartbeat &&
    now.getTime() - state.heartbeat.getTime() > 120000
  ) {
    await db.$transaction([
      db.creatureState.updateMany({
        where: {
          id: "benwa",
          status: "RUNNING",
          heartbeat: { lt: new Date(now.getTime() - 120000) },
        },
        data: {
          status: "REVIEW_REQUIRED",
          activity: "Worker heartbeat lost; review before resuming",
        },
      }),
      db.supervisorIntervention.create({
        data: {
          level: 4,
          reason:
            "The independent monitor detected a worker heartbeat gap exceeding two minutes. Model execution is paused for review; queued checkpoints remain intact.",
        },
      }),
    ]);
  }
  const projects = await db.project.findMany({ where: { status: "ACTIVE" } });
  for (const project of projects) {
    const stale =
      project.stagnantAttempts >= 3 &&
      now.getTime() - project.progressAt.getTime() >
        policy.stagnantSeconds * 1000;
    const expenses = await db.financialTransaction.findMany({
      where: { projectId: project.id, kind: { notIn: ["REVENUE", "REFUND"] } },
    });
    const cost = expenses.reduce((total, e) => total + e.amountMinor, 0n);
    const outcomes = await db.actionOutcome.count({
      where: { meaningful: true, action: { projectId: project.id } },
    });
    const costly =
      cost > policy.maxCostPerOutcomeMinor * BigInt(Math.max(1, outcomes));
    if (stale || costly) {
      const reason = `Independent review suspended ${project.name}: ${stale ? "three stagnant attempts and an elapsed progress timeout" : `recorded project cost ${cost} GBP minor units exceeds the per-outcome policy`}. Inspect failed actions and sources. Reconsider with new demand evidence or a smaller, materially different experiment.`;
      await db.$transaction(async (tx) => {
        const changed = await tx.project.updateMany({
          where: { id: project.id, status: "ACTIVE" },
          data: { status: "SUSPENDED" },
        });
        if (changed.count) {
          await tx.supervisorIntervention.create({
            data: { projectId: project.id, level: 3, reason },
          });
          await tx.memory.create({
            data: {
              category: "project",
              projectId: project.id,
              content: reason,
              verified: true,
              importance: 1,
            },
          });
        }
      });
    }
  }
  if ((await db.project.count({ where: { status: "SUSPENDED" } })) >= 2) {
    const changed = await db.creatureState.updateMany({
      where: { id: "benwa", status: "RUNNING" },
      data: {
        status: "REVIEW_REQUIRED",
        activity: "Multiple failed strategies need your review",
      },
    });
    if (changed.count)
      await db.supervisorIntervention.create({
        data: {
          level: 4,
          reason:
            "Independent monitor: multiple projects are suspended. Review the preserved failure reports and supply new evidence before resuming.",
        },
      });
  }
}
