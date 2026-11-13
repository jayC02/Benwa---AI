import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
function findRoot() {
  if (process.env.BENWA_ROOT) return path.resolve(process.env.BENWA_ROOT);
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(directory, "prisma", "schema.prisma")))
      return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    "Cannot locate the Benwa repository. Set BENWA_ROOT to its absolute path.",
  );
}
export const repoRoot = findRoot();
config({ path: path.join(repoRoot, ".env") });
const Environment = z.object({
  DATABASE_URL: z
    .string()
    .default(
      "postgresql://postgres:postgres@127.0.0.1:54329/benwa?connection_limit=1&pgbouncer=true&statement_cache_size=0",
    ),
  AGENT_MODE: z.enum(["demo", "real"]).default("demo"),
  AUTONOMY_MODE: z.enum(["supervised", "independent"]).default("supervised"),
  SEARCH_PROVIDER: z.enum(["public", "brave", "langsearch"]).default("public"),
  LANGSEARCH_API_KEY: z.string().default(""),
  FIRECRAWL_API_KEY: z.string().default(""),
  FIRECRAWL_BROWSER_TESTS_ALLOWED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LANGSEARCH_DAILY_TOKEN_LIMIT: z.coerce
    .number()
    .int()
    .min(1000)
    .max(10000000)
    .default(100000),
  FIRECRAWL_MONTHLY_CREDIT_LIMIT: z.coerce
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(900),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("gpt-4.1-mini"),
  LLM_PROVIDER: z
    .enum(["openai-compatible", "gemini"])
    .default("openai-compatible"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_PROJECT_ID: z.string().default(""),
  GEMINI_FREE_TIER_PROJECT_CONFIRMED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GEMINI_QUOTAS_JSON: z.string().default("{}"),
  GEMINI_EXPERIMENTAL_GEMMA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  LLM_MAX_INPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(100000)
    .default(32000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(8000)
    .default(2400),
  RESEARCH_HOSTS: z
    .string()
    .default("developer.mozilla.org,en.wikipedia.org,docs.python.org"),
  BRAVE_SEARCH_KEY: z.string().default(""),
  WORKSPACE_ROOT: z.string().default(".data/projects"),
  SANDBOX_IMAGE: z.string().default("benwa-sandbox:local"),
  DASHBOARD_PASSWORD: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  SUPERVISOR_STAGNANT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(604800)
    .default(3600),
  SUPERVISOR_MAX_COST_PER_OUTCOME_MINOR: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(100000000)
    .default(1000),
});
export const env = Environment.parse(process.env);
export const workspaceRoot = path.resolve(repoRoot, env.WORKSPACE_ROOT);
export const json = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
export const errorText = (e: unknown): string =>
  e instanceof Error ? e.message.slice(0, 1500) : "Unknown failure";
