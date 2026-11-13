import { defineConfig } from "prisma/config";
import { env } from "./packages/core/src/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: { url: process.env.DIRECT_URL || env.DATABASE_URL },
  migrations: { path: "prisma/migrations" },
});
