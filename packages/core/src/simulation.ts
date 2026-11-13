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
  failure: -2,
  repetition: -10,
  stagnation: -20,
  firstSale: 15,
};
export function simulate(
  previous: Emotions,
  event: EmotionalEvent,
  weights = defaultWeights,
): Emotions {
  // mood is the persisted happiness score. Other fields remain for old snapshots/exports;
  // they no longer drive behaviour or change with work, waiting or outcomes.
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
      break;
    case "milestone":
      state.mood += weights.milestone;
      break;
    case "repetition":
      state.mood += weights.repetition;
      break;
    case "stagnation":
      state.mood += weights.stagnation;
      break;
    case "failure":
      state.mood += weights.failure;
      break;
    case "work":
    case "rest":
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
      break;
    }
  }
  state.mood = Math.round(Math.max(0, Math.min(100, state.mood)) * 10) / 10;
  return state;
}
export function emotionalGuidance(s: Emotions): string[] {
  return [
    "Happiness is outcome feedback: verified useful progress is positive, failed or repetitive actions are negative, and routine work or waiting is neutral. It is not a need for sleep or a permission to bypass rules.",
    s.mood < 35
      ? "Recent outcomes have been poor. Review the concrete failure feedback, change approach and try a small useful test. Continue working; low happiness is not a reason to stop."
      : "Use the feedback on recent actions to repeat useful methods and avoid unsuccessful ones. Keep testing assumptions against evidence.",
    "Do not create easy filler actions to raise happiness. Useful failed experiments can inform the next approach; never hide or fabricate failures. Wait only when no productive work is available.",
  ];
}
