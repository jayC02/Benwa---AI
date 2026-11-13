import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { PoolClient } from "pg";
import { z } from "zod";

// Store PostgreSQL's own JSON text, preserving bigint values without JS rounding.
const Row = z.string().refine((value) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}, "Expected a PostgreSQL JSON record");
export const StateSnapshot = z.strictObject({
  format: z.literal("benwa-state-v1"),
  migrationsHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
  tables: z.array(z.strictObject({ name: z.string(), rows: z.array(Row) })),
});
export type StateSnapshot = z.infer<typeof StateSnapshot>;
const models = Prisma.dmmf.datamodel.models;
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableName = (model: (typeof models)[number]) =>
  model.dbName ?? model.name;

function orderedModels() {
  const ordered: (typeof models)[number][] = [];
  const pending = new Map(models.map((model) => [model.name, model]));
  while (pending.size) {
    let changed = false;
    for (const [name, model] of pending) {
      const dependencies = model.fields.filter(
        (field) => field.relationFromFields?.length && field.type !== name,
      );
      if (dependencies.some((field) => pending.has(field.type))) continue;
      ordered.push(model);
      pending.delete(name);
      changed = true;
    }
    if (!changed) throw new Error("Database has circular table dependencies");
  }
  return ordered;
}

function orderedRows(model: (typeof models)[number], rows: string[]) {
  const relations = model.fields.filter(
    (field) => field.type === model.name && field.relationFromFields?.length,
  );
  if (!relations.length) return rows;
  const pending = rows.map((text) => ({
    text,
    value: JSON.parse(text) as Record<string, unknown>,
  }));
  const inserted: Record<string, unknown>[] = [];
  const output: string[] = [];
  while (pending.length) {
    let changed = false;
    for (let i = 0; i < pending.length; ) {
      const row = pending[i];
      const ready = relations.every((relation) => {
        const from = relation.relationFromFields!;
        const to = relation.relationToFields!;
        return (
          from.some((field) => row.value[field] === null) ||
          inserted.some((parent) =>
            from.every(
              (field, index) => row.value[field] === parent[to[index]],
            ),
          )
        );
      });
      if (!ready) {
        i++;
        continue;
      }
      output.push(row.text);
      inserted.push(row.value);
      pending.splice(i, 1);
      changed = true;
    }
    if (!changed) throw new Error(`Invalid self-reference in ${model.name}`);
  }
  return output;
}

export async function migrationsHash(root: string) {
  const directory = path.join(root, "prisma", "migrations");
  const hash = createHash("sha256");
  for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(entry.name);
    hash.update(
      await fs.readFile(path.join(directory, entry.name, "migration.sql")),
    );
  }
  return hash.digest("hex");
}

export async function exportState(
  client: PoolClient,
  hash: string,
): Promise<StateSnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await client.query<{ status: string }>(
      'SELECT status FROM "CreatureState" WHERE id = $1',
      ["benwa"],
    );
    if (
      ![
        "PAUSED",
        "STOPPED",
        "WAITING_APPROVAL",
        "REVIEW_REQUIRED",
        "WAITING_ASSISTANCE",
        "BUDGET_PAUSED",
        "QUOTA_PAUSED",
      ].includes(state.rows[0]?.status ?? "")
    )
      throw new Error("Pause Benwa before exporting his state");
    const active = await client.query<{ count: string }>(
      'SELECT count(*) FROM "ScheduledJob" WHERE status = $1',
      ["RUNNING"],
    );
    if (active.rows[0].count !== "0")
      throw new Error("Wait for the active job to finish before exporting");
    const tables: StateSnapshot["tables"] = [];
    for (const model of orderedModels()) {
      const name = tableName(model);
      const result = await client.query<{ record: string }>(
        `SELECT row_to_json(t)::text AS record FROM public.${quoted(name)} t`,
      );
      tables.push({ name, rows: result.rows.map((row) => row.record) });
    }
    await client.query("COMMIT");
    return StateSnapshot.parse({
      format: "benwa-state-v1",
      migrationsHash: hash,
      createdAt: new Date().toISOString(),
      tables,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function importState(
  client: PoolClient,
  input: unknown,
  hash: string,
) {
  const snapshot = StateSnapshot.parse(input);
  if (snapshot.migrationsHash !== hash)
    throw new Error("Snapshot and destination migrations differ");
  const ordered = orderedModels();
  const expected = ordered.map(tableName);
  if (
    snapshot.tables.length !== expected.length ||
    new Set(snapshot.tables.map((table) => table.name)).size !==
      expected.length ||
    snapshot.tables.some((table) => !expected.includes(table.name))
  )
    throw new Error("Snapshot does not contain exactly the expected tables");
  await client.query("BEGIN");
  try {
    // Import only into an empty, migrated database. Never overwrite existing history.
    for (const name of expected) {
      await client.query(
        `LOCK TABLE public.${quoted(name)} IN ACCESS EXCLUSIVE MODE`,
      );
      const result = await client.query<{ count: string }>(
        `SELECT count(*) FROM public.${quoted(name)}`,
      );
      if (result.rows[0].count !== "0")
        throw new Error(
          `Destination ${name} is not empty; refusing to overwrite`,
        );
    }
    for (const model of ordered) {
      const name = tableName(model);
      const table = snapshot.tables.find((table) => table.name === name)!;
      for (const row of orderedRows(model, table.rows))
        await client.query(
          `INSERT INTO public.${quoted(name)} SELECT * FROM json_populate_record(NULL::public.${quoted(name)}, $1::json)`,
          [row],
        );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return snapshot.tables.reduce((total, table) => total + table.rows.length, 0);
}
