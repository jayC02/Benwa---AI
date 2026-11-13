import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { env, repoRoot, workspaceRoot } from "../packages/core/src/config.js";
import { exportState, migrationsHash } from "./deployment-state.js";

function command(program: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)),
    );
  });
}
function environment(values: Record<string, string>) {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (/[\r\n\0]/.test(value))
          throw new Error(`Multiline environment value is unsupported: ${key}`);
        return `${key}=${JSON.stringify(value)}`;
      })
      .join("\n") + "\n"
  );
}
async function checkWorkspace(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new Error(
        "Project transfer accepts only ordinary files and directories",
      );
    if (entry.isDirectory())
      await checkWorkspace(path.join(directory, entry.name));
  }
}
if (
  env.LLM_PROVIDER !== "gemini" ||
  !env.GEMINI_API_KEY ||
  !env.GEMINI_FREE_TIER_PROJECT_CONFIRMED
)
  throw new Error(
    "Deployment requires the configured Gemini key and confirmed free project; paid adapters are not enabled",
  );
const directory = path.join(repoRoot, ".data", "deploy");
const transfer = path.join(
  directory,
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
await fs.mkdir(transfer, { recursive: true, mode: 0o700 });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
try {
  const client = await pool.connect();
  try {
    const snapshot = await exportState(client, await migrationsHash(repoRoot));
    await fs.writeFile(
      path.join(transfer, "state.json"),
      JSON.stringify(snapshot),
      { mode: 0o600 },
    );
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
const databasePassword = randomBytes(32).toString("hex");
const password =
  env.DASHBOARD_PASSWORD || randomBytes(24).toString("base64url");
const values: Record<string, string> = {};
for (const key of [
  "GEMINI_API_KEY",
  "AUTONOMY_MODE",
  "SEARCH_PROVIDER",
  "GEMINI_PROJECT_ID",
  "GEMINI_QUOTAS_JSON",
  "LLM_MAX_INPUT_TOKENS",
  "LLM_MAX_OUTPUT_TOKENS",
  "RESEARCH_HOSTS",
  "BRAVE_SEARCH_KEY",
  "SUPERVISOR_STAGNANT_SECONDS",
  "SUPERVISOR_MAX_COST_PER_OUTCOME_MINOR",
] as const)
  values[key] = String(env[key]);
Object.assign(values, {
  AGENT_MODE: "real",
  LLM_PROVIDER: "gemini",
  GEMINI_FREE_TIER_PROJECT_CONFIRMED: "true",
  GEMINI_EXPERIMENTAL_GEMMA: String(env.GEMINI_EXPERIMENTAL_GEMMA),
  DATABASE_URL: `postgresql://benwa:${databasePassword}@127.0.0.1:5432/benwa?connection_limit=8`,
  DASHBOARD_PASSWORD: password,
  SESSION_SECRET: randomBytes(48).toString("hex"),
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "4321",
  BENWA_ROOT: "/opt/benwa",
  WORKSPACE_ROOT: "/var/lib/benwa/projects",
  SANDBOX_IMAGE: "benwa-sandbox:local",
});
await fs.writeFile(path.join(transfer, "runtime.env"), environment(values), {
  mode: 0o600,
});
await fs.writeFile(
  path.join(transfer, "postgres.env"),
  environment({
    POSTGRES_USER: "benwa",
    POSTGRES_DB: "benwa",
    POSTGRES_PASSWORD: databasePassword,
  }),
  { mode: 0o600 },
);
await fs.writeFile(
  path.join(transfer, "login.txt"),
  `Benwa dashboard password: ${password}\nKeep this file private. The URL is assigned after server creation.\n`,
  { mode: 0o600 },
);
await fs.mkdir(workspaceRoot, { recursive: true });
await checkWorkspace(workspaceRoot);
await command("tar", [
  "-czf",
  path.join(transfer, "projects.tar.gz"),
  "-C",
  workspaceRoot,
  ".",
]);
const source = path.join(transfer, "source.tar.gz");
await command("tar", [
  "--exclude=node_modules",
  "--exclude=dist",
  "--exclude=dist-phone",
  "--exclude=.astro",
  "--exclude=.env",
  "--exclude=.git",
  "-czf",
  source,
  "package.json",
  "package-lock.json",
  "prisma.config.ts",
  "tsconfig.json",
  "eslint.config.js",
  "vitest.config.ts",
  "playwright.config.ts",
  "apps",
  "packages",
  "prisma",
  "sandbox",
  "scripts",
  "deploy",
  "docs",
  "tests",
  "README.md",
]);
const key = path.join(directory, "benwa-server");
try {
  await fs.access(key);
} catch {
  await command("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-f",
    key,
    "-N",
    "",
    "-C",
    "benwa-server",
  ]);
}
const checksums: Record<string, string> = {};
for (const filename of [
  "source.tar.gz",
  "state.json",
  "projects.tar.gz",
  "runtime.env",
  "postgres.env",
])
  checksums[filename] = createHash("sha256")
    .update(await fs.readFile(path.join(transfer, filename)))
    .digest("hex");
await fs.writeFile(
  path.join(transfer, "checksums.json"),
  JSON.stringify(checksums, null, 2),
  { mode: 0o600 },
);
await fs.writeFile(
  path.join(transfer, "checksums.sha256"),
  Object.entries(checksums)
    .map(([filename, checksum]) => `${checksum}  ${filename}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
await fs.writeFile(
  path.join(directory, "latest.json"),
  JSON.stringify({ transfer, key, publicKey: `${key}.pub` }, null, 2),
  { mode: 0o600 },
);
console.log(`Private deployment package prepared at ${transfer}`);
console.log(
  `Use ${key}.pub as the server's SSH public key. Credentials have been saved locally and were not printed.`,
);
