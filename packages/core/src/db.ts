import { PrismaClient } from "@prisma/client";
import { env } from "./config.js";
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
}
