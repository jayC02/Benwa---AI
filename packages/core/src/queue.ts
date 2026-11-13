import { randomUUID } from "node:crypto";
import type { ScheduledJob, Prisma } from "@prisma/client";
import { db } from "./db.js";
export async function schedule(
  runAt = new Date(),
  client: Prisma.TransactionClient = db,
) {
  const job = await client.scheduledJob.upsert({
    where: { key: "creature-cycle" },
    update: {},
    create: { key: "creature-cycle", runAt },
  });
  await client.scheduledJob.updateMany({
    where: { id: job.id, status: { not: "RUNNING" } },
    data: {
      runAt,
      status: "PENDING",
      leaseToken: null,
      leaseUntil: null,
      attempts: 0,
    },
  });
  return job;
}
export async function claimJob(now = new Date()) {
  const token = randomUUID();
  const rows = await db.$queryRaw<ScheduledJob[]>`
    UPDATE "ScheduledJob" SET status='RUNNING',"leaseToken"=${token},"leaseUntil"=${new Date(now.getTime() + 90000)},attempts=attempts+1
    WHERE id=(SELECT id FROM "ScheduledJob" WHERE (status='PENDING' AND "runAt"<=${now}) OR (status='RUNNING' AND "leaseUntil"<${now}) ORDER BY "runAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  return rows[0] ?? null;
}
export async function renewLease(job: ScheduledJob) {
  const result = await db.scheduledJob.updateMany({
    where: { id: job.id, status: "RUNNING", leaseToken: job.leaseToken },
    data: { leaseUntil: new Date(Date.now() + 90000) },
  });
  if (result.count !== 1) throw new Error("Job lease lost");
}
export async function finishJob(
  job: ScheduledJob,
  runAt: Date | null,
  error?: string,
) {
  return db.scheduledJob.updateMany({
    where: { id: job.id, leaseToken: job.leaseToken, status: "RUNNING" },
    data: {
      status: runAt ? "PENDING" : "DONE",
      runAt: runAt ?? new Date(),
      leaseToken: null,
      leaseUntil: null,
      error,
      attempts: error ? job.attempts : 0,
      ...(!error ? { generation: { increment: 1 } } : {}),
    },
  });
}
export function retryAt(attempts: number, now = Date.now()) {
  return new Date(now + Math.min(300000, 2000 * 2 ** Math.min(attempts, 7)));
}
