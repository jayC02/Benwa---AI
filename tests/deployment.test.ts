import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import fs from "node:fs/promises";
import pg from "pg";
import {
  exportState,
  importState,
  migrationsHash,
} from "../scripts/deployment-state";

const databases: {
  database: PGlite;
  server: PGLiteSocketServer;
  pool: pg.Pool;
}[] = [];
let source: pg.PoolClient, target: pg.PoolClient, hash: string;
beforeAll(async () => {
  hash = await migrationsHash(process.cwd());
  for (let i = 0; i < 2; i++) {
    const database = await PGlite.create();
    for (const entry of (
      await fs.readdir("prisma/migrations", { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await database.exec(
        await fs.readFile(
          `prisma/migrations/${entry.name}/migration.sql`,
          "utf8",
        ),
      );
    const server = new PGLiteSocketServer({
      db: database,
      host: "127.0.0.1",
      port: 0,
    });
    await server.start();
    const pool = new pg.Pool({
      connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/benwa`,
      max: 1,
    });
    databases.push({ database, server, pool });
  }
  source = await databases[0].pool.connect();
  target = await databases[1].pool.connect();
  await source.query(`
    INSERT INTO "CreatureState" (id,status,mood,energy,"updatedAt") VALUES ('benwa','WAITING_APPROVAL',94,32,NOW());
    INSERT INTO "Project" (id,name,description,hypothesis,"updatedAt") VALUES ('project','Maker Margin','A saved project','{}',NOW());
    INSERT INTO "Goal" (id,title,"projectId") VALUES ('goal','Saved objective','project');
    INSERT INTO "Task" (id,"projectId",title,stage) VALUES ('parent','project','First task','TESTING');
    INSERT INTO "Task" (id,"projectId",title,stage,"dependsOnId") VALUES ('child','project','Dependent task','TESTING','parent');
    INSERT INTO "Memory" (id,category,content,verified) VALUES ('memory','knowledge','Benwa''s saved memory 🌱',true);
    INSERT INTO "Budget" (id,day,"tokensUsed","tokensReserved",calls) VALUES ('budget','2026-11-12',5665,77869,13);
    INSERT INTO "AgentCycle" (id,"jobId",provider) VALUES ('cycle','job','gemini');
    INSERT INTO "ModelRequest" (id,scope,"modelId","quotaDay",operation,tier,"estimatedInput","reservedTokens","budgetDay",reason,"cycleId")
      VALUES ('request','scope','gemini-3.1-flash-lite','2026-11-12','decision',1,500,2900,'2026-11-12','Existing quota history','cycle');
    INSERT INTO "ModelCooldown" (scope,key,until,reason) VALUES ('scope','group:generation-project','2026-11-14T01:00:00','Preserve provider cooldown');
    INSERT INTO "FinancialTransaction" (id,"externalId",kind,"amountMinor",currency,source,evidence)
      VALUES ('receipt','fixture-receipt','REVENUE',9007199254740993,'GBP','test','{"reference":"Precision fixture; not real income"}');
  `);
});
afterAll(async () => {
  source?.release();
  target?.release();
  for (const { database, server, pool } of databases) {
    await pool.end();
    await server.stop();
    await database.close();
  }
});

describe("Server state transfer", () => {
  it("preserves memory, emotions, tasks, token reservations and exact ledger integers", async () => {
    const snapshot = await exportState(source, hash);
    snapshot.tables.find((table) => table.name === "Task")!.rows.reverse();
    const count = await importState(target, snapshot, hash);
    expect(count).toBe(11);
    expect(
      (await target.query('SELECT mood, energy, status FROM "CreatureState"'))
        .rows[0],
    ).toEqual({ mood: 94, energy: 32, status: "WAITING_APPROVAL" });
    expect(
      (await target.query('SELECT content FROM "Memory"')).rows[0].content,
    ).toBe("Benwa's saved memory 🌱");
    expect(
      (
        await target.query(
          'SELECT "tokensUsed", "tokensReserved", calls FROM "Budget"',
        )
      ).rows[0],
    ).toEqual({ tokensUsed: 5665, tokensReserved: 77869, calls: 13 });
    expect(
      (await target.query('SELECT "amountMinor" FROM "FinancialTransaction"'))
        .rows[0].amountMinor,
    ).toBe("9007199254740993");
    expect(
      (await target.query('SELECT "cycleId" FROM "ModelRequest"')).rows[0]
        .cycleId,
    ).toBe("cycle");
    expect(
      (await target.query('SELECT count(*) FROM "ModelCooldown"')).rows[0]
        .count,
    ).toBe("1");
    await expect(
      target.query('UPDATE "FinancialTransaction" SET "amountMinor" = 1'),
    ).rejects.toThrow("append-only");
  });
  it("refuses to overwrite an existing database", async () => {
    const snapshot = await exportState(source, hash);
    await expect(importState(target, snapshot, hash)).rejects.toThrow(
      "not empty",
    );
    expect(
      (await target.query('SELECT count(*) FROM "Memory"')).rows[0].count,
    ).toBe("1");
  });
  it("rejects missing, duplicate or foreign tables and mismatched schema before writes", async () => {
    const snapshot = await exportState(source, hash);
    await expect(
      importState(
        target,
        { ...snapshot, migrationsHash: "0".repeat(64) },
        hash,
      ),
    ).rejects.toThrow("migrations differ");
    await expect(
      importState(
        target,
        { ...snapshot, tables: snapshot.tables.slice(1) },
        hash,
      ),
    ).rejects.toThrow("expected tables");
    await expect(
      importState(
        target,
        {
          ...snapshot,
          tables: snapshot.tables.map((table, i) =>
            i === 0 ? { ...table, name: "InjectedTable" } : table,
          ),
        },
        hash,
      ),
    ).rejects.toThrow("expected tables");
    await expect(
      importState(
        target,
        {
          ...snapshot,
          tables: snapshot.tables.map((table, i) =>
            i === 0 ? snapshot.tables[1] : table,
          ),
        },
        hash,
      ),
    ).rejects.toThrow("expected tables");
  });
  it("requires paused work and no leased action before export", async () => {
    await source.query('UPDATE "CreatureState" SET status = $1', ["RUNNING"]);
    await expect(exportState(source, hash)).rejects.toThrow("Pause Benwa");
    await source.query('UPDATE "CreatureState" SET status = $1', ["PAUSED"]);
    await source.query(
      'INSERT INTO "ScheduledJob" (id,key,status) VALUES ($1,$2,$3)',
      ["busy", "busy", "RUNNING"],
    );
    await expect(exportState(source, hash)).rejects.toThrow("active job");
    await source.query('DELETE FROM "ScheduledJob" WHERE id=$1', ["busy"]);
  });
});
