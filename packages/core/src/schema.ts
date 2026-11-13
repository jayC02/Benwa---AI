import { z } from "zod";
export const stages = [
  "DISCOVERY",
  "RESEARCH",
  "VALIDATION",
  "PLANNING",
  "BUILDING",
  "TESTING",
  "LAUNCH_APPROVAL",
  "OPERATION",
  "REVENUE_EVALUATION",
] as const;
export const tools = [
  "research.search",
  "research.fetch",
  "workspace.write",
  "workspace.read",
  "workspace.inspect",
  "sandbox.run",
  "browser.test",
  "project.plan",
  "project.advance",
  "project.reject",
  "memory.learn",
  "rest",
  "external.request",
] as const;
export const NewProject = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(1200),
  hypothesis: z.object({
    revenuePotential: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    cost: z.number().min(0).max(100),
    difficulty: z.number().min(0).max(100),
    validationHours: z.number().min(0).max(10000),
    distributionDifficulty: z.number().min(0).max(100),
    competition: z.number().min(0).max(100),
    risk: z.number().min(0).max(100),
    experimentValue: z.number().min(0).max(100),
  }),
});
export const Decision = z
  .object({
    projectId: z.string().nullable(),
    newProject: NewProject.nullable(),
    goal: z.string().min(5).max(300),
    category: z.enum([
      "research",
      "build",
      "test",
      "plan",
      "learn",
      "rest",
      "external",
    ]),
    target: z.string().min(1).max(500),
    intention: z.string().min(10).max(1000),
    rationale: z.string().min(10).max(1000),
    strategy: z.string().min(3).max(150),
    tool: z.enum(tools),
    input: z.record(z.string(), z.unknown()),
    expectedEvidence: z.string().min(5).max(500),
    costEstimateMinor: z.number().int().nonnegative().max(1000000),
    permissions: z.array(z.string().max(80)).max(12),
    thought: z.string().min(5).max(200),
  })
  .strict()
  .refine(
    (v) => Boolean(v.projectId) !== Boolean(v.newProject),
    "Choose one existing project or one new project",
  );
export type Decision = z.infer<typeof Decision>;
export type ToolName = (typeof tools)[number];
export const ToolResult = z.object({
  summary: z.string().max(2000),
  evidence: z.record(z.string(), z.unknown()),
  kind: z.enum([
    "source",
    "artifact",
    "plan",
    "test",
    "lesson",
    "rest",
    "stage",
    "rejection",
    "external",
  ]),
  success: z.boolean(),
  simulated: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof ToolResult>;
export const Settings = z
  .object({
    cycleSeconds: z.number().int().min(5).max(3600),
    maxSteps: z.number().int().min(1).max(200),
    restSeconds: z.number().int().min(30).max(3600),
    dailyTokenLimit: z.number().int().min(0).max(10000000),
    maxProjects: z.number().int().min(1).max(5),
    authorisedMinor: z.string().regex(/^\d{1,9}$/),
  })
  .strict();
