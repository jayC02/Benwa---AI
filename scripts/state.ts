import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { env, repoRoot } from "../packages/core/src/config.js";
import {
  exportState,
  importState,
  migrationsHash,
} from "./deployment-state.js";

const [operation, filename] = process.argv.slice(2);
if (!["export", "import"].includes(operation) || !filename)
  throw new Error(
    "Usage: npm run state -- export|import <private-snapshot.json>",
  );
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  const hash = await migrationsHash(repoRoot);
  if (operation === "export") {
    const snapshot = await exportState(client, hash);
    await fs.mkdir(path.dirname(path.resolve(filename)), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(snapshot), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      `Saved ${snapshot.tables.reduce((n, table) => n + table.rows.length, 0)} records. Keep this file private; transfer the project workspace alongside it.`,
    );
  } else {
    const count = await importState(
      client,
      JSON.parse(await fs.readFile(filename, "utf8")) as unknown,
      hash,
    );
    console.log(
      `Restored ${count} records, including memory, approvals and quota history. No existing records were overwritten.`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
