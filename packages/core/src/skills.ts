import { z } from "zod";

export const skillCatalog = [
  {
    id: "coding",
    name: "Coding",
    description: "Building and improving verified project artifacts.",
  },
  {
    id: "intelligence",
    name: "Intelligence",
    description:
      "Recorded progress in reasoning, implementation and problem solving.",
  },
  {
    id: "creativity",
    name: "Creativity",
    description: "Turning new ideas into novel saved plans and artifacts.",
  },
  {
    id: "research",
    name: "Research",
    description: "Reading new sources that advance the current objective.",
  },
  {
    id: "testing",
    name: "Testing",
    description:
      "Checking actual artifacts and resolving verified test failures.",
  },
  {
    id: "planning",
    name: "Planning",
    description: "Creating useful plans and completing evidence-based stages.",
  },
  {
    id: "business",
    name: "Business",
    description:
      "Developing and validating projects and recording real financial outcomes.",
  },
  {
    id: "adaptability",
    name: "Adaptability",
    description: "Succeeding with a changed approach after a failed action.",
  },
] as const;
export type SkillId = (typeof skillCatalog)[number]["id"];
const rating = z.number().finite().min(0).max(100);
export const SkillRatings = z
  .object({
    coding: rating,
    intelligence: rating,
    creativity: rating,
    research: rating,
    testing: rating,
    planning: rating,
    business: rating,
    adaptability: rating,
  })
  .strict();
export type SkillRatings = z.infer<typeof SkillRatings>;
export const emptySkills = (): SkillRatings => ({
  coding: 0,
  intelligence: 0,
  creativity: 0,
  research: 0,
  testing: 0,
  planning: 0,
  business: 0,
  adaptability: 0,
});
export function readSkillRatings(value: unknown): SkillRatings {
  return SkillRatings.safeParse(value).data ?? emptySkills();
}

const awards: Record<string, Partial<SkillRatings>> = {
  "workspace.write": { coding: 1, creativity: 0.5, intelligence: 0.5 },
  "workspace.inspect": { testing: 0.5, intelligence: 0.5 },
  "sandbox.run": { testing: 1, coding: 0.5, intelligence: 0.5 },
  "browser.test": { testing: 1, coding: 0.5, intelligence: 0.5 },
  "research.fetch": { research: 1, intelligence: 0.5 },
  "project.plan": {
    planning: 1,
    creativity: 0.5,
    business: 0.5,
    intelligence: 0.5,
  },
  "project.advance": { business: 1, planning: 0.5, intelligence: 0.5 },
  "project.reject": { business: 0.5, intelligence: 0.5 },
  rest: { planning: 0.5 },
  financial: { business: 1 },
};

/** Game progress from independently checked outcomes, not an IQ/model benchmark. */
export function applySkillOutcome(
  previous: unknown,
  event: {
    tool: string;
    target?: string;
    progress: boolean;
    failed: boolean;
    recovered?: boolean;
    repeatedFailure?: boolean;
  },
) {
  const ratings = readSkillRatings(previous);
  const changes: Partial<
    Record<SkillId, { before: number; after: number; delta: number }>
  > = {};
  const direction = event.failed ? -1 : event.progress ? 1 : 0;
  const relevant =
    event.tool === "workspace.write" &&
    event.target &&
    !/\.(html|css|js|mjs|cjs|ts|tsx|jsx|py|sql|json|svg)$/i.test(event.target)
      ? { planning: 0.5, creativity: 0.5, intelligence: 0.5 }
      : (awards[event.tool] ?? {});
  const deltas: Partial<SkillRatings> = direction
    ? Object.fromEntries(
        Object.entries(relevant).map(([id, points]) => [
          id,
          points * direction,
        ]),
      )
    : {};
  if (event.progress && !event.failed && event.recovered)
    deltas.adaptability = 1;
  if (event.failed && event.repeatedFailure) deltas.adaptability = -1;
  for (const { id } of skillCatalog) {
    if (!deltas[id]) continue;
    const before = ratings[id];
    const after =
      Math.round(Math.min(100, Math.max(0, before + deltas[id]!)) * 10) / 10;
    ratings[id] = after;
    changes[id] = {
      before,
      after,
      delta: Math.round((after - before) * 10) / 10,
    };
  }
  return { ratings, changes };
}
