import { db } from "../db.js";
import { digest } from "../supervisor.js";
import type { AgentContext } from "../provider.js";
import type { RoutingTask } from "./policy.js";
export async function requestHumanAssistance(
  context: AgentContext,
  task: RoutingTask,
  reason: string,
) {
  if (!task.projectId)
    throw new Error("Human assistance requires a specific project");
  const project = context.projects.find((p) => p.id === task.projectId);
  const attempts = context.recent
    .filter((a) => a.projectId === task.projectId)
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      tool: a.tool,
      status: a.status,
      outcome: a.outcome,
    }));
  const prompt = `Help Benwa with this blocked project.\n\nObjective\n${project?.name}: ${JSON.stringify(project?.goals ?? [])}\n\nWhy he is stuck\n${reason}\n\nWhat he has attempted\n${JSON.stringify(attempts, null, 2).slice(0, 9000)}\n\nWhat needs to be done\nDiagnose the root cause from the saved evidence. Propose a materially different, concrete fix or experiment. Specify files, commands or validation steps where relevant. Missing infrastructure and permissions require operator action, not more model calls.\n\nSuccessful result\nA reproducible fix or falsifiable next experiment, with checks that demonstrate success and explicit remaining uncertainty.\n\nBoundaries\nNo unauthorised spending, publishing, outreach or changes to Benwa's supervisor, ledger or emotions. Return guidance for the operator to review. No connection to personal Codex or Claude accounts is authorised.`;
  const issueKey = digest(task.issueKey ?? task.projectId);
  const modelAttempts = await db.modelRequest.findMany({
    where: { projectId: task.projectId, issueKey: task.issueKey },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      modelId: true,
      status: true,
      reason: true,
      error: true,
      createdAt: true,
    },
  });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CreatureState" WHERE id='benwa' FOR UPDATE`;
    const history = await tx.humanAssistanceRequest.findMany({
      where: { issueKey: { startsWith: issueKey } },
      orderBy: { createdAt: "desc" },
    });
    const request =
      history.find((item) => item.status === "OPEN") ??
      (await tx.humanAssistanceRequest.create({
        data: {
          issueKey: `${issueKey}:${history.length}`,
          projectId: task.projectId!,
          title: `Help with ${project?.name ?? "a project"}`,
          prompt: `${prompt}\n\nModel attempts\n${JSON.stringify(modelAttempts, null, 2).slice(0, 5000)}`,
        },
      }));
    await tx.project.update({
      where: { id: task.projectId! },
      data: { status: "WAITING_ASSISTANCE" },
    });
    return request;
  });
}
