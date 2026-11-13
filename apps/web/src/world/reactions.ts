export type Reaction = "hop" | "slump" | "dance" | "bigDance";

export interface ReactionInput {
  actions: {
    id: string;
    status: string;
    outcome: {
      verified: boolean;
      meaningful: boolean;
      simulated: boolean;
    } | null;
  }[];
  milestones: { id: string; simulated: boolean }[];
  netMinor: string;
}

const MAX_REACTIONS = 3;

/** One-off reactions caused by what changed between two snapshots. Simulated evidence never celebrates. */
export function detectReactions(
  prev: ReactionInput | null,
  next: ReactionInput,
): Reaction[] {
  if (!prev) return [];
  const before = new Map(prev.actions.map((a) => [a.id, a.status]));
  const changed = next.actions.filter((a) => before.get(a.id) !== a.status);
  const out: Reaction[] = [];
  if (changed.some((a) => a.status === "FAILED")) out.push("slump");
  if (
    changed.some(
      (a) =>
        a.status === "SUCCEEDED" &&
        a.outcome?.verified &&
        a.outcome.meaningful &&
        !a.outcome.simulated,
    )
  )
    out.push("hop");
  const seen = new Set(prev.milestones.map((m) => m.id));
  if (next.milestones.some((m) => !seen.has(m.id) && !m.simulated))
    out.push("dance");
  if (BigInt(next.netMinor) > BigInt(prev.netMinor)) out.push("bigDance");
  return out.slice(0, MAX_REACTIONS);
}
