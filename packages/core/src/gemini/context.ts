import type { AgentContext } from "../provider.js";
import { ProviderError } from "../provider.js";
import { estimatedInput, geminiPayload } from "./transport.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Excerpts exist only in the outgoing prompt. Persistent records are never edited.
function excerpt(value: unknown, characters: number, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > characters
      ? `${value.slice(0, characters)}… [excerpt; full record retained]`
      : value;
  if (!value || typeof value !== "object" || value instanceof Date)
    return value;
  if (depth >= 6) return "[nested observation omitted; full record retained]";
  if (Array.isArray(value))
    return value.slice(0, 16).map((v) => excerpt(v, characters, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      excerpt(v, characters, depth + 1),
    ]),
  );
}

function pending(value: unknown, stage: string, maximum: number) {
  if (!Array.isArray(value)) return excerpt(value, 1000);
  return value
    .filter(
      (v) =>
        !/^(COMPLETED|COMPLETE|SUCCEEDED|CANCELLED)$/.test(
          String(record(v).status),
        ),
    )
    .sort(
      (a, b) =>
        Number(record(b).stage === stage) - Number(record(a).stage === stage),
    )
    .slice(0, maximum)
    .map((v) => excerpt(v, 1000));
}

function observation(
  action: AgentContext["recent"][number],
  characters: number,
) {
  const packed = excerpt(action, characters) as typeof action;
  const source = record(record(action.outcome).evidence);
  // Keep a valid continuation cursor even when the prompt needs a smaller file chunk.
  if (action.tool === "workspace.read" && typeof source.content === "string") {
    const offset = typeof source.offset === "number" ? source.offset : 0;
    let end = Math.min(source.content.length, characters);
    if (end && /[\uD800-\uDBFF]/.test(source.content[end - 1])) end--;
    const content = source.content.slice(0, end);
    record(packed.outcome).evidence = {
      ...source,
      content,
      nextOffset:
        end < source.content.length ? offset + end : source.nextOffset,
    };
  }
  return packed;
}

/** Focus each decision on a bounded slice of real work, without extra inference calls. */
export function packGeminiContext(context: AgentContext, inputCeiling: number) {
  const original = geminiPayload(context);
  if (estimatedInput(original) <= inputCeiling) return original;
  const primary = context.projects[0];
  const recent = [...context.recent].sort(
    (a, b) =>
      Number(b.projectId === primary?.id) - Number(a.projectId === primary?.id),
  );
  for (let level = 0; level < 5; level++) {
    const characters = [4000, 2400, 1400, 800, 400][level];
    const recentCount = [4, 3, 2, 1, 1][level];
    const memoryCount = [8, 6, 4, 2, 1][level];
    const focused: AgentContext = {
      ...structuredClone(context),
      projects: context.projects
        .slice(0, level >= 2 ? 1 : undefined)
        .map((p, i) => ({
          ...p,
          description: excerpt(
            p.description,
            i ? 400 : Math.max(1200, characters),
          ) as string | undefined,
          hypothesis: excerpt(
            p.hypothesis,
            i ? 400 : Math.max(1000, characters),
          ),
          tasks: pending(p.tasks, p.stage, i ? 1 : level >= 3 ? 2 : 6),
          goals: pending(p.goals, p.stage, i ? 1 : level >= 3 ? 1 : 3),
          checkpoint: excerpt(p.checkpoint, Math.max(800, characters)),
        })),
      recent: recent
        .slice(0, recentCount)
        .map((a, i) => observation(a, i ? 600 : characters)),
      memories: context.memories
        .slice(0, memoryCount)
        .map((m) => excerpt(m, Math.max(1000, characters))),
      contextWindow: {
        mode: "focused",
        omittedRecent: Math.max(0, context.recent.length - recentCount),
        omittedMemories: Math.max(0, context.memories.length - memoryCount),
        omittedProjects:
          level >= 2 ? Math.max(0, context.projects.length - 1) : 0,
        notice:
          "Observations and task lists may be excerpts. Full history, goals, files and memory remain saved. Advance one small part of the current objective. Read source using workspace.read offset/limit and nextOffset; never assume an excerpt is the complete source or overwrite a file using only its excerpt.",
      },
    };
    const payload = geminiPayload(focused);
    if (estimatedInput(payload) <= inputCeiling) return payload;
  }
  // Permissions, supervisor restrictions and system/tool contracts must never be cut to fit.
  throw new ProviderError(
    `Configured input ceiling (${inputCeiling}) cannot fit required instructions and the current objective. Increase LLM_MAX_INPUT_TOKENS within verified free model/quota limits. No inference request was sent.`,
    false,
  );
}
