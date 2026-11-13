import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../packages/core/src/config.js";
const dir = path.join(repoRoot, ".data", "postgres");
await fs.mkdir(dir, { recursive: true });
const database = await PGlite.create(dir);
const server = new PGLiteSocketServer({
  db: database,
  host: "127.0.0.1",
  port: 54329,
  maxConnections: 20,
});
await server.start();
console.log(
  "Benwa local PostgreSQL listening at 127.0.0.1:54329 (development only; disk persisted)",
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void (async () => {
      await server.stop();
      await database.close();
      process.exit(0);
    })();
  });
