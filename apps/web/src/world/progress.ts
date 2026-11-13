export type Step =
  | "idle"
  | "deciding"
  | "doing"
  | "checking"
  | "done"
  | "failed"
  | "waiting"
  | "deferred";

/** Where the current action is in its cycle. Status outranks cycle stage, except while a new decision is being made. */
export function actionStep(
  cycle: { id: string; stage: string } | null,
  action: { cycleId: string; status: string } | null,
): Step {
  if (!cycle && !action) return "idle";
  const current =
    action && cycle && action.cycleId === cycle.id ? action : null;
  if (cycle?.stage === "DECIDING" && !current) return "deciding";
  if (cycle?.stage === "WAITING_ASSISTANCE") return "waiting";
  const subject = current ?? action;
  if (!subject) return "idle";
  switch (subject.status) {
    case "AWAITING_APPROVAL":
      return "waiting";
    case "FAILED":
      return "failed";
    case "DEFERRED":
      return "deferred";
    case "SUCCEEDED":
      return "done";
  }
  if (current && cycle?.stage === "VERIFYING") return "checking";
  if (current) return "doing";
  return "done";
}

export type Badge =
  | "verified"
  | "demo"
  | "failed"
  | "waiting"
  | "deferred"
  | "nothing-new"
  | "in-progress";

export const BADGE_LABEL: Record<Badge, string> = {
  verified: "Verified",
  demo: "Demo",
  failed: "Failed",
  waiting: "Waiting for you",
  deferred: "Deferred",
  "nothing-new": "Done, nothing new",
  "in-progress": "In progress",
};

export function outcomeBadge(action: {
  status: string;
  outcome: {
    verified: boolean;
    meaningful: boolean;
    simulated: boolean;
  } | null;
}): Badge {
  if (action.status === "FAILED") return "failed";
  if (action.status === "AWAITING_APPROVAL") return "waiting";
  if (action.status === "DEFERRED") return "deferred";
  const o = action.outcome;
  if (!o) return "in-progress";
  if (o.simulated) return "demo";
  if (o.verified && o.meaningful) return "verified";
  return "nothing-new";
}

export const STAGES = [
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

export type StageState = "done" | "demo" | "current" | "todo";

const label = (stage: string) => {
  const words = stage.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A milestone's stage is the stage that was completed (see project.advance). */
export function stageTrack(project: {
  stage: string;
  milestones: { stage: string; simulated: boolean }[];
}): { stage: string; label: string; state: StageState }[] {
  const byStage = new Map(project.milestones.map((m) => [m.stage, m]));
  return STAGES.map((stage) => {
    const milestone = byStage.get(stage);
    const state: StageState = milestone
      ? milestone.simulated
        ? "demo"
        : "done"
      : stage === project.stage
        ? "current"
        : "todo";
    return { stage, label: label(stage), state };
  });
}
