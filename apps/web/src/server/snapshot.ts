import { db, financialSummary, env, modelMonitor } from "@benwa/core";
import { ROOM_IDS, ROOMS, type RoomId } from "../world/rooms";
const historySelect = {
  id: true,
  cycleId: true,
  projectId: true,
  tool: true,
  intention: true,
  status: true,
  createdAt: true,
  outcome: {
    select: {
      summary: true,
      verified: true,
      meaningful: true,
      simulated: true,
    },
  },
} as const;
async function roomHistory() {
  const rows = await Promise.all(
    ROOM_IDS.map((id) =>
      db.action.findMany({
        where: { tool: { in: [...ROOMS[id].tools] } },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: historySelect,
      }),
    ),
  );
  return Object.fromEntries(ROOM_IDS.map((id, i) => [id, rows[i]])) as Record<
    RoomId,
    (typeof rows)[number]
  >;
}
/** Recent actions for every ACTIVE project plus the project of the latest action, whatever its status. */
async function projectHistory() {
  const [active, latest] = await Promise.all([
    db.project.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true },
    }),
    db.action.findFirst({
      orderBy: { createdAt: "desc" },
      select: { projectId: true },
    }),
  ]);
  const ids = [
    ...new Set([
      ...active.map((p) => p.id),
      ...(latest ? [latest.projectId] : []),
    ]),
  ];
  const rows = await Promise.all(
    ids.map((projectId) =>
      db.action.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: historySelect,
      }),
    ),
  );
  return Object.fromEntries(ids.map((id, i) => [id, rows[i]])) as Record<
    string,
    (typeof rows)[number]
  >;
}
export async function snapshot() {
  const [
    creature,
    configuration,
    rawProjects,
    actions,
    memories,
    interventions,
    approvals,
    emotions,
    finance,
    budget,
    job,
    supervisorJob,
    models,
    assistance,
  ] = await Promise.all([
    db.creatureState.findUniqueOrThrow({ where: { id: "benwa" } }),
    db.agentConfiguration.findUniqueOrThrow({ where: { id: "main" } }),
    db.project.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        tasks: true,
        milestones: {
          include: {
            evidenceAction: {
              select: { outcome: { select: { simulated: true } } },
            },
          },
        },
        experiments: true,
      },
    }),
    db.action.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { outcome: true, executions: true },
    }),
    db.memory.findMany({
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
    db.supervisorIntervention.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.approvalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { action: true },
    }),
    db.emotionSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 24 }),
    financialSummary(),
    db.budget.findUnique({
      where: { day: new Date().toISOString().slice(0, 10) },
    }),
    db.scheduledJob.findUnique({ where: { key: "creature-cycle" } }),
    db.scheduledJob.findUnique({ where: { key: "supervisor-monitor" } }),
    modelMonitor(),
    db.humanAssistanceRequest.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  const [cycle, byProject, byRoom] = await Promise.all([
    db.agentCycle.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, stage: true, createdAt: true, completedAt: true },
    }),
    projectHistory(),
    roomHistory(),
  ]);
  const projects = rawProjects.map(({ milestones, ...project }) => ({
    ...project,
    milestones: milestones.map(({ evidenceAction, ...milestone }) => ({
      ...milestone,
      simulated: evidenceAction.outcome?.simulated ?? false,
    })),
  }));
  return {
    creature,
    configuration,
    projects,
    actions,
    memories,
    interventions,
    approvals,
    emotions,
    finance,
    budget,
    job,
    models,
    assistance,
    cycle,
    projectHistory: byProject,
    roomHistory: byRoom,
    providerConfigured: Boolean(
      env.LLM_PROVIDER === "gemini" ? env.GEMINI_API_KEY : env.LLM_API_KEY,
    ),
    searchConfigured:
      env.SEARCH_PROVIDER === "public" || Boolean(env.BRAVE_SEARCH_KEY),
    searchProvider: env.SEARCH_PROVIDER,
    webAccess: env.RESEARCH_HOSTS.split(",").some((host) => host.trim() === "*")
      ? "public"
      : "restricted",
    autonomyMode: env.AUTONOMY_MODE,
    serverTime: new Date().toISOString(),
    workerOnline: Boolean(
      creature.heartbeat && Date.now() - creature.heartbeat.getTime() < 15000,
    ),
    supervisorOnline: Boolean(
      supervisorJob && Date.now() - supervisorJob.runAt.getTime() < 30000,
    ),
  };
}
// Wire values include decimal strings for integer monetary amounts and ISO strings for dates.
type Wire<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends Array<infer U>
      ? Wire<U>[]
      : T extends object
        ? { [K in keyof T]: Wire<T[K]> }
        : T;
export type Snapshot = Wire<Awaited<ReturnType<typeof snapshot>>>;
