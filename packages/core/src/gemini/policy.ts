import { z } from "zod";
import type { AgentContext } from "../provider.js";
import type { Capability, ModelSpec } from "./catalog.js";
export interface RoutingTask {
  kind:
    | "routine"
    | "research"
    | "summary"
    | "plan"
    | "debug"
    | "code"
    | "strategy";
  tier: 1 | 2 | 3;
  important: boolean;
  required: Capability[];
  reason: string;
  projectId?: string;
  issueKey?: string;
}
const object = (value: unknown) =>
  z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
export function classifyTask(context: AgentContext): RoutingTask {
  const project = context.projects[0];
  const tasks = Array.isArray(project?.tasks) ? project.tasks : [];
  const pending = tasks.map(object).find((t) => t.status === "PENDING");
  const text = String(
    pending?.title ??
      `${project?.name ?? ""} ${JSON.stringify(project?.goals ?? [])}`,
  ).toLowerCase();
  const lightweight =
    /^(fix a typo|correct spelling|rename|format|summari[sz]e|list|organi[sz]e|read|document)\b/.test(
      text,
    );
  const failures = context.recent
    .filter((a) => a.projectId === project?.id && a.status === "FAILED")
    .slice(0, 4);
  const observations = failures
    .map((f) => JSON.stringify(f.outcome))
    .join(" ")
    .toLowerCase();
  const infrastructure =
    (context.capabilities?.sandbox === false && project?.stage === "TESTING") ||
    /sandbox unavailable|install docker|enoent|eacces|permission|not configured|http 40[13]|http 429|quota|dns|timed out|network/.test(
      observations,
    );
  const reasoning =
    failures.length >= 2 &&
    !infrastructure &&
    /assertion|test.*fail|typeerror|referenceerror|incorrect|schema|logic|algorithm/.test(
      observations,
    );
  const complex =
    !lightweight &&
    /concurren|distributed|cryptograph|security|multi.module|race condition|algorithm|major.*evaluat|complex.*(code|strateg|migration)/.test(
      text,
    );
  const blocked = context.restrictions.some(
    (r) => Number(object(r).level) >= 2 && object(r).projectId === project?.id,
  );
  const tier = infrastructure
    ? 1
    : complex || (reasoning && blocked)
      ? 3
      : reasoning ||
          (!lightweight &&
            ["BUILDING", "TESTING", "PLANNING", "REVENUE_EVALUATION"].includes(
              project?.stage ?? "",
            ))
        ? 2
        : 1;
  return {
    kind: reasoning
      ? "debug"
      : tier === 3
        ? "strategy"
        : project?.stage === "BUILDING"
          ? "code"
          : tier === 2
            ? "plan"
            : project?.stage === "RESEARCH"
              ? "research"
              : "routine",
    tier,
    important: tier === 3,
    required: ["tools", "structured"],
    reason: infrastructure
      ? "Investigate an infrastructure or permission failure; stronger reasoning will not fix unavailable tools."
      : reasoning && blocked
        ? "Repeated reasoning/test failures after supervisor intervention justify advanced diagnosis."
        : complex
          ? "The pending objective requires complex code or strategic reasoning."
          : tier === 2
            ? "Planning, implementation or testing benefits from intermediate reasoning."
            : "Routine next-action selection; preserve advanced model allowance.",
    projectId: project?.id,
    issueKey: project
      ? `${project.id}:${String(pending?.id ?? project.stage)}`
      : undefined,
  };
}
export function rankCandidates(
  task: RoutingTask,
  models: ModelSpec[],
  performance: Map<string, { successes: number; failures: number }>,
  experimental = false,
) {
  return models
    .filter(
      (m) =>
        m.freeStandard &&
        task.required.every((c) => m.capabilities.includes(c)) &&
        (!m.expiresAt || new Date(m.expiresAt) > new Date()) &&
        (!m.experimental || (experimental && task.kind === "summary")) &&
        (m.tier <= task.tier ||
          (task.tier === 1 && task.kind !== "summary" && m.tier === 2) ||
          (m.tier === 4 && experimental && task.kind === "summary")),
    )
    .sort((a, b) => {
      const score = (m: ModelSpec) => {
        const p = performance.get(m.id);
        const quality = p
          ? (p.successes + 2) / (p.successes + p.failures + 3)
          : 0.67;
        return (
          Math.abs(m.tier - task.tier) * 100 +
          models.indexOf(m) * 2 +
          (1 - quality) * 8
        );
      };
      return score(a) - score(b);
    });
}
export function pacificDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}
export function nextPacificReset(now = new Date()) {
  const day = pacificDay(now);
  let lower = now.getTime(),
    upper = lower + 27 * 3600000;
  while (upper - lower > 1000) {
    const middle = Math.floor((lower + upper) / 2);
    if (pacificDay(new Date(middle)) === day) lower = middle;
    else upper = middle;
  }
  return new Date(Math.ceil(upper / 1000) * 1000);
}
