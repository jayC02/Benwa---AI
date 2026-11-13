import { z } from "zod";
import { env } from "../config.js";
export type Capability =
  | "tools"
  | "structured"
  | "text"
  | "embedding"
  | "decision";
export interface Limits {
  rpm: number;
  tpm: number;
  rpd: number;
}
export interface ModelSpec {
  id: string;
  label: string;
  tier: 1 | 2 | 3 | 4;
  capabilities: Capability[];
  limits: Limits;
  reserve: number;
  groups: string[];
  freeStandard: boolean;
  expiresAt?: string;
  experimental?: boolean;
  note?: string;
  probeThinking?: "minimal" | "low";
}
export const routingPolicy = {
  maximumAttempts: 3,
  invalidCooldownMs: 5 * 60000,
  probeRetryBaseMs: 15 * 60000,
  probeRetryMaximumMs: 6 * 3600000,
  maximumAutomaticProbeFailures: 4,
  performanceSamplesPerModel: 20,
} as const;
const lite: Limits = { rpm: 15, tpm: 250000, rpd: 500 },
  flash: Limits = { rpm: 5, tpm: 250000, rpd: 20 },
  gemma: Limits = { rpm: 30, tpm: 16000, rpd: 14400 };
const agent: Capability[] = ["tools", "structured", "text"];
/** IDs/capabilities/pricing verified in official Google documentation, 2026-11-12.
 * Never use display-name guessing, paid variants, grounding, caches, batch or priority APIs. */
export const modelCatalog: readonly ModelSpec[] = [
  {
    id: "gemini-3.5-flash-lite",
    probeThinking: "minimal",
    label: "Gemini 3.5 Flash-Lite",
    tier: 1,
    capabilities: agent,
    limits: lite,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    probeThinking: "minimal",
    label: "Gemini 3.1 Flash-Lite",
    tier: 1,
    capabilities: agent,
    limits: lite,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-3.8-flash",
    probeThinking: "low",
    label: "Gemini 3.8 Flash",
    tier: 2,
    capabilities: agent,
    limits: flash,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-3.6-flash",
    probeThinking: "minimal",
    label: "Gemini 3.6 Flash",
    tier: 2,
    capabilities: agent,
    limits: flash,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-4-hydrogen",
    probeThinking: "low",
    label: "Gemini 4 Hydrogen",
    tier: 3,
    capabilities: agent,
    limits: flash,
    reserve: 5,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-3-flash-preview",
    probeThinking: "minimal",
    label: "Gemini 3 Flash",
    tier: 2,
    capabilities: agent,
    limits: flash,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    tier: 2,
    capabilities: agent,
    limits: flash,
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
    expiresAt: "2026-12-01T00:00:00Z",
    note: "Legacy access only; disabled before Google automatically routes this ID to a different model.",
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    tier: 1,
    capabilities: agent,
    limits: { rpm: 10, tpm: 250000, rpd: 20 },
    reserve: 0,
    groups: ["generation-project"],
    freeStandard: true,
    note: "Existing API users only; explicit access probe required.",
  },
  {
    id: "gemma-4-26b-a4b-it",
    label: "Gemma 4 26B A4B",
    tier: 4,
    capabilities: ["text", "tools"],
    limits: gemma,
    reserve: 0,
    groups: ["generation-project", "gemma-4-family"],
    freeStandard: true,
    experimental: true,
    note: "Function calls are documented; constrained JSON output equivalence is not assumed. Plain text tasks only until separately evaluated.",
  },
  {
    id: "gemma-4-31b-it",
    label: "Gemma 4 31B",
    tier: 4,
    capabilities: ["text", "tools"],
    limits: gemma,
    reserve: 0,
    groups: ["generation-project", "gemma-4-family"],
    freeStandard: true,
    experimental: true,
    note: "Not eligible for the structured agent decision contract.",
  },
  {
    id: "gemini-decision-1",
    label: "Gemini Decision 1",
    tier: 2,
    capabilities: ["decision"],
    limits: { rpm: 0, tpm: 0, rpd: 0 },
    reserve: 0,
    groups: ["specialized-project"],
    freeStandard: true,
    note: "Dedicated Decisions API; no generated action envelope. Disabled until operator supplies verified quota.",
  },
  {
    id: "gemini-embedding-001",
    label: "Gemini Embedding 1",
    tier: 1,
    capabilities: ["embedding"],
    limits: { rpm: 0, tpm: 0, rpd: 0 },
    reserve: 0,
    groups: ["embedding-family"],
    freeStandard: true,
    note: "Text embeddings, 2048 input tokens. Not a decision model; quota configuration required.",
  },
  {
    id: "gemini-embedding-2",
    label: "Gemini Embedding 2",
    tier: 1,
    capabilities: ["embedding"],
    limits: { rpm: 0, tpm: 0, rpd: 0 },
    reserve: 0,
    groups: ["embedding-family"],
    freeStandard: true,
    note: "Multimodal embeddings, 8192 input tokens. Separate vector space; no automatic migration of memories.",
  },
];
// These are conservative application ceilings, NOT a claim of provider quota independence.
// In particular Gemma family allowances are not added, and built-in shared tools are disabled.
export const defaultGroupLimits: Record<string, Limits> = {
  "generation-project": { rpm: 15, tpm: 250000, rpd: 500 },
  "gemma-4-family": gemma,
  "specialized-project": { rpm: 0, tpm: 0, rpd: 0 },
  "embedding-family": { rpm: 0, tpm: 0, rpd: 0 },
};
const quota = z
  .object({
    rpm: z.number().int().min(0).max(10000),
    tpm: z.number().int().min(0).max(10000000),
    rpd: z.number().int().min(0).max(1000000),
  })
  .strict();
const Overrides = z
  .object({
    models: z.record(z.string(), quota).default({}),
    groups: z.record(z.string(), quota).default({}),
  })
  .strict();
export function routingConfiguration() {
  const overrides = Overrides.parse(JSON.parse(env.GEMINI_QUOTAS_JSON));
  for (const id of Object.keys(overrides.models))
    if (!modelCatalog.some((m) => m.id === id))
      throw new Error(`Unreviewed model quota: ${id}`);
  for (const key of Object.keys(overrides.groups))
    if (!(key in defaultGroupLimits))
      throw new Error(`Unreviewed quota group: ${key}`);
  return {
    models: modelCatalog.map((m) => ({
      ...m,
      limits: overrides.models[m.id] ?? m.limits,
    })),
    groups: { ...defaultGroupLimits, ...overrides.groups },
  };
}
export function freeProjectGuard() {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(env.GEMINI_PROJECT_ID))
    throw new Error(
      "Set GEMINI_PROJECT_ID to the dedicated Google project ID; quotas are project scoped",
    );
  if (!env.GEMINI_FREE_TIER_PROJECT_CONFIRMED)
    throw new Error(
      "Gemini inference is disabled. Verify this key belongs to an unbilled Free-tier project, then explicitly set GEMINI_FREE_TIER_PROJECT_CONFIRMED=true. The SDK cannot certify billing status.",
    );
}
