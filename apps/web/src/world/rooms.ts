export type RoomId =
  | "hall"
  | "study"
  | "workshop"
  | "library"
  | "planning"
  | "journal"
  | "bedroom";
export type Activity =
  | "work"
  | "ponder"
  | "sleep"
  | "sit"
  | "wait"
  | "confused";

export const ROOM_IDS: readonly RoomId[] = [
  "hall",
  "study",
  "workshop",
  "library",
  "planning",
  "journal",
  "bedroom",
];

export const ROOMS: Record<
  RoomId,
  { name: string; floor: 0 | 1 | 2; tools: readonly string[]; colour: string }
> = {
  hall: {
    name: "Front hall",
    floor: 0,
    tools: ["external.request"],
    colour: "#e7c9a9",
  },
  study: {
    name: "Study",
    floor: 0,
    tools: ["workspace.write", "workspace.read", "workspace.inspect"],
    colour: "#a9c4e0",
  },
  workshop: {
    name: "Workshop",
    floor: 0,
    tools: ["sandbox.run", "browser.test"],
    colour: "#e6b8a2",
  },
  library: {
    name: "Library",
    floor: 1,
    tools: ["research.search", "research.fetch"],
    colour: "#b9d3b0",
  },
  planning: {
    name: "Planning room",
    floor: 1,
    tools: ["project.plan", "project.advance", "project.reject"],
    colour: "#f0d9a0",
  },
  journal: {
    name: "Journal nook",
    floor: 1,
    tools: ["memory.learn"],
    colour: "#cdbfe3",
  },
  bedroom: { name: "Bedroom", floor: 2, tools: ["rest"], colour: "#c9d6e6" },
};

export function roomForTool(tool: string): RoomId | null {
  for (const id of ROOM_IDS) if (ROOMS[id].tools.includes(tool)) return id;
  return null;
}

export interface WorldInput {
  status: string;
  workerOnline: boolean;
  cycle: { id: string; stage: string } | null;
  latestAction: { cycleId: string; tool: string; status: string } | null;
  pendingApprovals: number;
  openAssistance: number;
  previousRoom: RoomId | null;
}
export interface WorldTarget {
  room: RoomId;
  activity: Activity;
  label: string | null;
}

const EXECUTING_STAGES = new Set(["VALIDATING", "EXECUTING", "VERIFYING"]);
const PAUSED = new Set(["PAUSED", "BUDGET_PAUSED", "QUOTA_PAUSED"]);

const target = (
  room: RoomId,
  activity: Activity,
  label: string | null = null,
): WorldTarget => ({
  room,
  activity,
  label,
});

/** First matching rule wins; see the design doc's room selection rules 1–7. */
export function selectScene(input: WorldInput): WorldTarget {
  const { status, cycle, latestAction } = input;
  const actionRoom = latestAction ? roomForTool(latestAction.tool) : null;
  if (!input.workerOnline) return target("bedroom", "sleep", "Worker offline");
  if (status === "REVIEW_REQUIRED" || status === "ERROR")
    return target(input.previousRoom ?? actionRoom ?? "bedroom", "confused");
  if (status === "WAITING_APPROVAL" || status === "WAITING_ASSISTANCE")
    return target("hall", "wait");
  const pending = input.pendingApprovals > 0 || input.openAssistance > 0;
  const executing =
    latestAction !== null &&
    cycle !== null &&
    EXECUTING_STAGES.has(cycle.stage) &&
    latestAction.cycleId === cycle.id &&
    latestAction.status === "PLANNED";
  // The runtime keeps working while reviews are pending, so real work wins over waiting by the door.
  if (status === "RUNNING" && executing) {
    const room = actionRoom ?? input.previousRoom ?? "bedroom";
    return target(
      room,
      room === "bedroom" ? "sleep" : "work",
      pending ? "Needs your review" : null,
    );
  }
  if (pending) return target("hall", "wait");
  if (status === "RESTING") return target("bedroom", "sleep");
  if (PAUSED.has(status)) return target("bedroom", "sit");
  if (!latestAction) return target("bedroom", "sit");
  return target(actionRoom ?? input.previousRoom ?? "bedroom", "ponder");
}
