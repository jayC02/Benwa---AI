import { createHash } from "node:crypto";
import type { Decision, ToolResult } from "./schema.js";
export const digest = (data: string) =>
  createHash("sha256").update(data).digest("hex");
const stop = new Set([
  "a",
  "an",
  "the",
  "for",
  "to",
  "of",
  "and",
  "with",
  "new",
  "better",
  "again",
  "please",
  "try",
  "search",
  "find",
  "research",
  "investigate",
  "explore",
]);
export const canonical = (s: string) =>
  s
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((v) => v.length > 2 && !stop.has(v))
    .sort()
    .join(" ");
export function similarity(a: string, b: string): number {
  const aa = new Set(canonical(a).split(" ")),
    bb = new Set(canonical(b).split(" "));
  return (
    [...aa].filter((x) => bb.has(x)).length /
    Math.max(1, new Set([...aa, ...bb]).size)
  );
}
export function fingerprint(
  a: Pick<Decision, "tool" | "target" | "intention">,
): string {
  return digest(`${a.tool}|${canonical(a.target)}|${canonical(a.intention)}`);
}
export interface History {
  tool: string;
  target: string;
  intention: string;
  strategy: string;
  fingerprint: string;
  meaningful: boolean;
  failed: boolean;
}
export function assessRepetition(
  candidate: Pick<Decision, "tool" | "target" | "intention" | "strategy">,
  history: History[],
) {
  const recent = history.slice(0, 12);
  let stagnant = 0;
  for (const h of recent) {
    // A verified productive result breaks a stagnant sequence, even with the same tool.
    if (h.meaningful) break;
    if (
      h.tool === candidate.tool &&
      (canonical(h.target) === canonical(candidate.target) ||
        similarity(h.intention, candidate.intention) > 0.55 ||
        canonical(h.strategy) === canonical(candidate.strategy))
    )
      stagnant++;
  }
  return {
    stagnant,
    level: stagnant >= 3 ? 2 : stagnant >= 1 ? 1 : 0,
    blocked: stagnant >= 3,
  };
}
export function verifyResult(result: ToolResult, seenHashes: Set<string>) {
  const evidenceHash = digest(
    `${result.kind}:${String(result.evidence.contentHash ?? JSON.stringify(result.evidence))}`,
  );
  const eligible = ["source", "artifact", "test", "plan", "stage"].includes(
    result.kind,
  );
  const meaningful =
    result.success &&
    eligible &&
    Object.keys(result.evidence).length > 0 &&
    !seenHashes.has(evidenceHash);
  return { verified: result.success, meaningful, evidenceHash };
}
export function permissionCheck(
  a: Pick<Decision, "tool" | "costEstimateMinor" | "permissions">,
): { allowed: boolean; reason: string } {
  if (a.costEstimateMinor > 0)
    return {
      allowed: false,
      reason:
        "Real expenditure requires human approval and a connected executor. No automatic spend is authorised.",
    };
  if (a.tool === "external.request")
    return {
      allowed: false,
      reason:
        "External publication, outreach, purchases and financial operations require approval.",
    };
  // Actual tool implementations determine access. Model-written labels such as
  // "browser" cannot expand privileges or make a free local test need consent.
  return {
    allowed: true,
    reason: "Within local execution and approved public research permissions.",
  };
}
