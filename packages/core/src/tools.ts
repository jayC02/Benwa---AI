import fs from "node:fs/promises";
import { z } from "zod";
import type { Action, Task } from "@prisma/client";
import { db } from "./db.js";
import { digest } from "./supervisor.js";
import { stages, type ToolName, type ToolResult } from "./schema.js";
import { safeFile, readArtifact } from "./workspace.js";
import { fetchPublic, searchPublic } from "./research.js";
import { runSandbox } from "./sandbox.js";
import { sandboxAvailable } from "./sandbox.js";
import { env } from "./config.js";
import { BrowserCheck, firecrawlBrowserTest } from "./external-research.js";
export const toolInputs = {
  "research.search": z.object({ query: z.string().min(5).max(300) }).strict(),
  "research.fetch": z.object({ url: z.string().url().max(1000) }).strict(),
  "workspace.write": z
    .object({
      path: z.string().max(240),
      content: z.string().min(40).max(80000),
    })
    .strict(),
  "workspace.read": z
    .object({
      path: z.string().max(240),
      offset: z.number().int().min(0).max(200000).optional(),
      limit: z.number().int().min(100).max(4000).optional(),
    })
    .strict(),
  "workspace.inspect": z
    .object({
      path: z.string().max(240),
      contains: z.array(z.string().min(2).max(100)).min(1).max(10),
    })
    .strict(),
  "sandbox.run": z
    .object({ command: z.enum(["test", "node"]), file: z.string().max(240) })
    .strict(),
  "browser.test": z
    .object({
      path: z.string().endsWith(".html").max(240),
      checks: z.array(BrowserCheck).max(20).optional(),
    })
    .strict(),
  "project.plan": z
    .object({
      tasks: z
        .array(
          z.object({
            title: z.string().min(5).max(200),
            stage: z.enum(stages),
          }),
        )
        .min(1)
        .max(12),
      hypothesis: z.string().min(10).max(1000),
      successCriterion: z.string().min(10).max(1000),
    })
    .strict(),
  "project.advance": z
    .object({ evidenceActionId: z.string(), nextStage: z.enum(stages) })
    .strict(),
  "project.reject": z
    .object({
      reason: z.string().min(20).max(1000),
      reconsiderWhen: z.string().min(10).max(1000),
    })
    .strict(),
  "memory.learn": z
    .object({
      content: z.string().min(20).max(1000),
      supersedesId: z.string().optional(),
    })
    .strict(),
  rest: z.object({ seconds: z.number().int().min(30).max(3600) }).strict(),
  "external.request": z
    .object({
      kind: z.enum([
        "publish",
        "outreach",
        "purchase",
        "advertising",
        "paid_account",
        "contract",
        "transfer",
      ]),
      description: z.string().min(10).max(2000),
      payload: z.string().max(10000),
    })
    .strict(),
} satisfies Record<ToolName, z.ZodType>;
export const toolDescriptions: Record<ToolName, string> = {
  "research.search":
    "Discover public sources through the configured search provider. The free public provider searches Wikipedia and Hacker News; use returned URLs and source links for broader research. Results are leads, not verified demand.",
  "research.fetch":
    "Read a public HTTPS page on an exact operator-approved hostname. Enforces DNS, robots, size and time limits.",
  "workspace.write":
    "Write a source/text file inside this project. Read-back hash verifies actual bytes; it does not prove commercial value.",
  "workspace.read":
    "Read one project text-file chunk (default 2000 characters). Continue with returned nextOffset; null means EOF. contentHash identifies the complete file: restart if it changes. Reading alone does not earn a progress reward.",
  "workspace.inspect":
    "Check required text in an artifact. Static inspection only, not an executed application test.",
  "sandbox.run":
    "Execute node or node --test for a project file in a networkless, read-only Docker sandbox. Never executes on the host.",
  "browser.test":
    "Run the project HTML in an isolated browser. For interactive pages supply checks: fill {selector,value}, click {selector}, then text {selector,contains} to assert the expected result. A screenshot alone is not a functional test. No host execution occurs.",
  "project.plan":
    "Persist a dependency-ordered task plan and a falsifiable experiment. This is preparation, not evidence of demand.",
  "project.advance":
    "Advance exactly one stage using an actual successful, novel action as evidence. Launch requires human review.",
  "project.reject":
    "Reject a weak idea with a lesson and explicit conditions for reconsideration.",
  "memory.learn":
    "Persist an unverified, revisable belief. Cannot edit historical facts and does not earn rewards.",
  rest: "Wait briefly only when no actionable pending work is available. Work does not cause tiredness; waiting never raises happiness. Quota and provider cooldown waits are scheduled automatically.",
  "external.request":
    "Prepare a consequential action for human review. No external executor is enabled in the MVP.",
};
export async function executeTool(
  action: Action,
  mode: "demo" | "real",
): Promise<ToolResult> {
  const name = action.tool as ToolName;
  if (!toolInputs[name]) throw new Error("Unknown tool");
  const input = toolInputs[name].parse(action.input);
  const result = (
    kind: ToolResult["kind"],
    summary: string,
    evidence: Record<string, unknown>,
    success = true,
    simulated = false,
  ): ToolResult => ({ kind, summary, evidence, success, simulated });
  switch (name) {
    case "research.fetch": {
      const p = toolInputs[name].parse(input);
      if (mode === "demo")
        return result(
          "source",
          "Demo research fixture: makers need a transparent break-even calculator. Demand remains unvalidated.",
          {
            url: p.url,
            text: "DEMO FIXTURE: A cost calculator helps makers compare price, unit cost, payment fees and monthly overhead. This is synthetic research, not customer evidence.",
            contentHash: digest("demo-market-fixture-v1"),
          },
          true,
          true,
        );
      const source = await fetchPublic(p.url);
      return result("source", `Retrieved public source: ${source.url}`, {
        ...source,
        contentHash: digest(source.text),
      });
    }
    case "research.search": {
      const p = toolInputs[name].parse(input);
      if (mode === "demo")
        return result(
          "source",
          "Demo search fixture; no live search was performed.",
          {
            query: p.query,
            results: [
              {
                title: "Synthetic maker interview note",
                url: "https://example.invalid/demo",
                description: "Fixture only. Demand has not been verified.",
              },
            ],
            contentHash: digest("demo-search-fixture-v1"),
          },
          true,
          true,
        );
      const results = await searchPublic(p.query);
      return result(
        "source",
        `Found ${results.length} public sources`,
        {
          results,
          substantive: false,
          contentHash: digest(JSON.stringify(results)),
        },
        results.length > 0,
      );
    }
    case "workspace.write": {
      const p = toolInputs[name].parse(input);
      const file = await safeFile(action.projectId, p.path, true);
      if (
        !/\.(html|css|js|mjs|cjs|ts|tsx|json|md|txt|csv|svg|py)$/.test(p.path)
      )
        throw new Error(
          "Only project source and text artifacts may be written",
        );
      let previous = "";
      try {
        previous = await readArtifact(action.projectId, p.path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (previous === p.content)
        return result(
          "artifact",
          "Artifact already has these bytes",
          { path: p.path, contentHash: digest(p.content) },
          true,
        );
      const changed =
        Math.abs(p.content.length - previous.length) +
        p.content
          .split("\n")
          .filter((l) => !previous.split("\n").includes(l))
          .join("\n").length;
      await fs.writeFile(file, p.content, { encoding: "utf8", flag: "w" });
      const persisted = await readArtifact(action.projectId, p.path);
      return result(
        "artifact",
        `Wrote and read back ${p.path} (${Buffer.byteLength(persisted)} bytes)`,
        {
          path: p.path,
          bytes: Buffer.byteLength(persisted),
          contentHash: digest(persisted),
          substantive: changed >= 40,
        },
        persisted === p.content,
      );
    }
    case "workspace.read": {
      const p = toolInputs[name].parse(input);
      const content = await readArtifact(action.projectId, p.path);
      const offset = p.offset ?? 0;
      if (offset > content.length)
        throw new Error("Read offset exceeds file length");
      let end = Math.min(content.length, offset + (p.limit ?? 2000));
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]))
        end--;
      return result("lesson", `Read ${p.path}`, {
        path: p.path,
        content: content.slice(offset, end),
        offset,
        nextOffset: end < content.length ? end : null,
        totalCharacters: content.length,
        contentHash: digest(content),
      });
    }
    case "workspace.inspect": {
      const p = toolInputs[name].parse(input);
      const content = await readArtifact(action.projectId, p.path);
      const missing = p.contains.filter((s) => !content.includes(s));
      return result(
        "test",
        missing.length
          ? `Static check failed: ${missing.join(", ")}`
          : `Static checks passed for ${p.path}; runtime behaviour is not tested`,
        {
          path: p.path,
          checks: p.contains,
          missing,
          inspection: "static",
          contentHash: digest(`static:${digest(content)}`),
        },
        missing.length === 0,
      );
    }
    case "sandbox.run":
    case "browser.test": {
      const p =
        name === "sandbox.run"
          ? toolInputs["sandbox.run"].parse(input)
          : {
              file: toolInputs["browser.test"].parse(input).path,
              command: "browser" as const,
            };
      await safeFile(action.projectId, p.file);
      const content = await readArtifact(action.projectId, p.file);
      const run =
        name === "browser.test" &&
        !(await sandboxAvailable()) &&
        env.FIRECRAWL_API_KEY
          ? await firecrawlBrowserTest(
              content,
              toolInputs["browser.test"].parse(input).checks,
            )
          : await runSandbox(action.projectId, action.id, p.command, p.file);
      return result(
        "test",
        `${name === "browser.test" ? "Browser" : "Sandbox"} ${run.code === 0 ? "passed" : "failed"} for ${p.file}`,
        {
          ...run,
          path: p.file,
          inspection: name === "browser.test" ? "browser" : "runtime",
          contentHash: digest(`${name}:${content}:${run.stdout}:${run.code}`),
        },
        run.code === 0,
      );
    }
    case "project.plan": {
      const p = toolInputs[name].parse(input);
      await db.$transaction(async (tx) => {
        let dependency: string | null = null;
        for (const task of p.tasks) {
          const existing = await tx.task.findFirst({
            where: {
              projectId: action.projectId,
              title: task.title,
              stage: task.stage,
            },
          });
          const t: Task =
            existing ??
            (await tx.task.create({
              data: {
                ...task,
                projectId: action.projectId,
                dependsOnId: dependency,
              },
            }));
          dependency = t.id;
        }
        const existing = await tx.experiment.findFirst({
          where: { projectId: action.projectId, hypothesis: p.hypothesis },
        });
        if (!existing)
          await tx.experiment.create({
            data: {
              projectId: action.projectId,
              hypothesis: p.hypothesis,
              successCriterion: p.successCriterion,
            },
          });
      });
      return result("plan", "Saved a task plan and falsifiable experiment", {
        tasks: p.tasks,
        hypothesis: p.hypothesis,
        successCriterion: p.successCriterion,
        contentHash: digest(JSON.stringify(p)),
      });
    }
    case "project.advance": {
      const p = toolInputs[name].parse(input);
      const project = await db.project.findUniqueOrThrow({
        where: { id: action.projectId },
      });
      if (project.stage === p.nextStage) {
        const milestone = await db.projectMilestone.findUnique({
          where: { evidenceActionId: p.evidenceActionId },
        });
        if (milestone?.projectId === project.id)
          return result(
            "stage",
            `Advanced to ${p.nextStage.toLowerCase().replaceAll("_", " ")}`,
            {
              from: milestone.stage,
              to: p.nextStage,
              evidenceActionId: p.evidenceActionId,
            },
          );
      }
      if (
        stages.indexOf(p.nextStage) !==
        stages.indexOf(project.stage as (typeof stages)[number]) + 1
      )
        throw new Error("Project stages must advance one step at a time");
      if (project.stage === "LAUNCH_APPROVAL")
        throw new Error(
          "Public operation is disabled until a publication adapter and human launch evidence are connected",
        );
      const evidence = await db.action.findUnique({
        where: { id: p.evidenceActionId },
        include: { outcome: true },
      });
      if (
        !evidence ||
        evidence.projectId !== action.projectId ||
        !evidence.outcome?.verified ||
        !evidence.outcome.meaningful ||
        evidence.createdAt < project.stageChangedAt
      )
        throw new Error("A fresh verified project outcome is required");
      const required: Record<string, string[]> = {
        DISCOVERY: ["project.plan"],
        RESEARCH: ["research.fetch", "research.search"],
        VALIDATION: ["research.fetch", "research.search", "workspace.write"],
        PLANNING: ["project.plan"],
        BUILDING: ["workspace.write"],
        TESTING: ["sandbox.run", "browser.test"],
        OPERATION: ["research.fetch"],
      };
      if (!required[project.stage]?.includes(evidence.tool))
        throw new Error(
          `The evidence tool does not satisfy the ${project.stage} stage`,
        );
      await db.$transaction(async (tx) => {
        await tx.projectMilestone.upsert({
          where: {
            projectId_stage: { projectId: project.id, stage: project.stage },
          },
          update: {},
          create: {
            projectId: project.id,
            stage: project.stage,
            evidenceActionId: evidence.id,
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: {
            stage: p.nextStage,
            stageChangedAt: new Date(),
            verifiedMilestones: { increment: 1 },
          },
        });
        await tx.task.updateMany({
          where: { projectId: project.id, stage: project.stage },
          data: { status: "DONE" },
        });
      });
      return result(
        "stage",
        `Advanced to ${p.nextStage.toLowerCase().replaceAll("_", " ")}`,
        { from: project.stage, to: p.nextStage, evidenceActionId: evidence.id },
        true,
        evidence.outcome.simulated,
      );
    }
    case "project.reject": {
      const p = toolInputs[name].parse(input);
      await db.project.update({
        where: { id: action.projectId },
        data: { status: "REJECTED" },
      });
      await db.memory.create({
        data: {
          category: "project",
          projectId: action.projectId,
          content: `Rejected: ${p.reason}. Reconsider when: ${p.reconsiderWhen}`,
          sourceActionId: action.id,
          verified: false,
          importance: 0.9,
        },
      });
      return result(
        "rejection",
        "Rejected the opportunity and preserved the lesson",
        p,
      );
    }
    case "memory.learn": {
      const p = toolInputs[name].parse(input);
      if (p.supersedesId) {
        const old = await db.memory.findUnique({
          where: { id: p.supersedesId },
        });
        if (!old || old.verified)
          throw new Error("Verified facts cannot be revised by the creature");
      }
      if (
        !(await db.memory.findFirst({
          where: { sourceActionId: action.id, category: "semantic" },
        }))
      )
        await db.memory.create({
          data: {
            category: "semantic",
            projectId: action.projectId,
            content: p.content,
            supersedesId: p.supersedesId,
            sourceActionId: action.id,
            verified: false,
          },
        });
      return result("lesson", "Saved a revisable belief", {
        content: p.content,
      });
    }
    case "rest": {
      const p = toolInputs[name].parse(input);
      const cfg = await db.agentConfiguration.findUniqueOrThrow({
        where: { id: "main" },
      });
      const browser =
        Boolean(env.FIRECRAWL_API_KEY && env.FIRECRAWL_BROWSER_TESTS_ALLOWED) ||
        (await sandboxAvailable());
      const work = await db.project.count({
        where: {
          status: "ACTIVE",
          tasks: { some: { status: "PENDING" } },
          actions: { none: { approval: { is: { status: "PENDING" } } } },
          stage: {
            notIn: [
              ...(!browser ? ["TESTING"] : []),
              ...(env.AUTONOMY_MODE === "independent"
                ? ["LAUNCH_APPROVAL"]
                : []),
            ],
          },
        },
      });
      if (work)
        throw new Error(
          "Actionable pending work remains; continue it instead of waiting. Tiredness is disabled.",
        );
      const seconds = Math.max(cfg.restSeconds, Math.min(p.seconds, 1800));
      await db.creatureState.updateMany({
        where: { id: "benwa", status: "RUNNING" },
        data: {
          status: "RESTING",
          restStartedAt: new Date(),
          restUntil: new Date(Date.now() + seconds * 1000),
          activity: "Waiting for useful work",
        },
      });
      return result(
        "rest",
        "Waiting briefly because no actionable pending work is available; happiness is unchanged",
        { seconds },
      );
    }
    case "external.request":
      throw new Error(
        "Consequential actions must be intercepted by the approval gate",
      );
  }
}
