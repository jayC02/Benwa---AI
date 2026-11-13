export interface Emotions {
  mood: number;
  energy: number;
  curiosity: number;
  boredom: number;
  confidence: number;
  frustration: number;
}
export type EmotionalEvent =
  | {
      kind:
        | "discovery"
        | "milestone"
        | "repetition"
        | "stagnation"
        | "failure"
        | "work"
        | "rest";
      seconds?: number;
      effort?: number;
    }
  | { kind: "financial"; netMinor: bigint; firstSale: boolean };
export const defaultWeights = {
  discovery: 2,
  milestone: 3,
  repetition: -10,
  stagnation: -20,
  firstSale: 15,
};
export function simulate(
  previous: Emotions,
  event: EmotionalEvent,
  weights = defaultWeights,
): Emotions {
  // Pick only simulated variables: callers may pass a full persisted creature row.
  const state: Emotions = {
    mood: previous.mood,
    energy: previous.energy,
    curiosity: previous.curiosity,
    boredom: previous.boredom,
    confidence: previous.confidence,
    frustration: previous.frustration,
  };
  switch (event.kind) {
    case "discovery":
      state.mood += weights.discovery;
      state.curiosity += 1;
      state.boredom -= 4;
      state.confidence += 1;
      break;
    case "milestone":
      state.mood += weights.milestone;
      state.confidence += 3;
      state.boredom -= 6;
      state.frustration -= 3;
      break;
    case "repetition":
      state.mood += weights.repetition;
      state.boredom += 8;
      state.frustration += 5;
      state.confidence -= 2;
      break;
    case "stagnation":
      state.mood += weights.stagnation;
      state.frustration += 9;
      state.confidence -= 4;
      break;
    case "failure":
      state.mood -= 2;
      state.confidence -= 2;
      state.frustration += 3;
      break;
    case "work":
      state.energy -= event.effort ?? 4;
      state.boredom += 0.5;
      break;
    case "rest":
      state.energy += Math.min(25, Math.max(0, event.seconds ?? 0) / 6);
      state.frustration -= Math.min(3, (event.seconds ?? 0) / 60);
      break;
    case "financial": {
      const capped = Number(
        event.netMinor > 1000000000n
          ? 1000000000n
          : event.netMinor < -1000000000n
            ? -1000000000n
            : event.netMinor,
      );
      const reward =
        Math.sign(capped) *
        Math.min(12, Math.log1p(Math.abs(capped) / 100) * 2);
      state.mood +=
        reward + (event.firstSale && capped > 0 ? weights.firstSale : 0);
      state.confidence += Math.sign(capped) * 2;
      break;
    }
  }
  for (const key of Object.keys(state) as (keyof Emotions)[])
    state[key] = Math.round(Math.max(0, Math.min(100, state[key])) * 10) / 10;
  return state;
}
export function emotionalGuidance(s: Emotions): string[] {
  return [
    s.energy < 25
      ? "Use light work or rest; infrastructure remains available."
      : "Energy supports focused work.",
    s.mood < 35
      ? "Review failure evidence and reconsider assumptions."
      : "Pursue measured progress.",
    s.confidence < 35
      ? "Prefer small inexpensive validation experiments."
      : "Keep confidence tied to evidence.",
    s.boredom > 65 || s.frustration > 65
      ? "Change assumptions or investigate a different approach."
      : "Continue only while outcomes are useful.",
  ];
}
