import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { simulate } from "./simulation.js";
const Transaction = z.object({
  externalId: z.string().min(4).max(200),
  kind: z.enum(["REVENUE", "REFUND", "FEE", "API_COST", "HOSTING", "EXPENSE"]),
  amountMinor: z.string().regex(/^[1-9]\d{0,11}$/),
  currency: z.literal("GBP"),
  source: z.enum(["human", "stripe"]),
  evidence: z.object({ reference: z.string().min(5).max(1000) }),
  projectId: z.string().min(1).max(100).optional(),
});
export type VerifiedTransaction = z.infer<typeof Transaction>;
// This module is never part of the LLM tool registry. Trust comes from authenticated HTTP or signed webhook routes.
export async function recordTransaction(
  input: unknown,
  authority: "authenticated-human" | "signed-stripe",
) {
  const data = Transaction.parse(input);
  if ((authority === "signed-stripe") !== (data.source === "stripe"))
    throw new Error("Transaction authority does not match source");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const existing = await tx.financialTransaction.findUnique({
      where: { externalId: data.externalId },
    });
    if (existing) {
      if (
        existing.kind !== data.kind ||
        existing.amountMinor !== BigInt(data.amountMinor) ||
        existing.currency !== data.currency ||
        existing.source !== data.source
      )
        throw new Error(
          "Transaction reference already exists with different accounting values",
        );
      return existing;
    }
    if (data.projectId)
      await tx.project.findUniqueOrThrow({ where: { id: data.projectId } });
    const first =
      (await tx.financialTransaction.count({ where: { kind: "REVENUE" } })) ===
      0;
    const row = await tx.financialTransaction.create({
      data: { ...data, amountMinor: BigInt(data.amountMinor) },
    });
    const state = await tx.creatureState.findUniqueOrThrow({
      where: { id: "benwa" },
    });
    const net = (data.kind === "REVENUE" ? 1n : -1n) * row.amountMinor;
    // First sale reward requires realised aggregate net profit, after all recorded attributable costs.
    const all = await tx.financialTransaction.findMany();
    const netTotal = all.reduce(
      (n, r) => n + (r.kind === "REVENUE" ? r.amountMinor : -r.amountMinor),
      0n,
    );
    const values = simulate(state, {
      kind: "financial",
      netMinor: net,
      firstSale: first && data.kind === "REVENUE" && netTotal > 0n,
    });
    await tx.creatureState.update({ where: { id: "benwa" }, data: values });
    await tx.emotionSnapshot.create({
      data: {
        values: { ...values },
        event: `Verified ${data.kind.toLowerCase()}: ${data.externalId}`,
      },
    });
    await tx.memory.create({
      data: {
        category: "financial",
        content: `${data.kind}: ${data.amountMinor} GBP minor units. Evidence: ${data.evidence.reference}`,
        verified: true,
        importance: 1,
      },
    });
    return row;
  });
}
export async function financialSummary() {
  const rows = await db.financialTransaction.findMany({
    orderBy: { createdAt: "desc" },
  });
  let revenue = 0n,
    expenses = 0n,
    api = 0n,
    refunds = 0n;
  for (const r of rows) {
    if (r.kind === "REVENUE") revenue += r.amountMinor;
    else {
      expenses += r.amountMinor;
      if (r.kind === "API_COST") api += r.amountMinor;
      if (r.kind === "REFUND") refunds += r.amountMinor;
    }
  }
  return {
    currency: "GBP",
    revenue,
    expenses,
    refunds,
    api,
    net: revenue - expenses,
    transactions: rows,
  };
}
export function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const parts = header.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  if (!timestamp || Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error("Expired Stripe signature");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const valid = parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const value = p.slice(3);
      return (
        /^[a-f0-9]{64}$/.test(value) &&
        timingSafeEqual(Buffer.from(value), Buffer.from(expected))
      );
    });
  if (!valid) throw new Error("Invalid Stripe signature");
}
