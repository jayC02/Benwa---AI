import type { Snapshot } from "../server/snapshot";
import { ROOMS, selectScene, type RoomId } from "../world/rooms";
import { actionStep, type Step } from "../world/progress";
import { ROOM_ICON, activityWords, ago, worldInput } from "./worldText";

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const FINAL: Partial<Record<Step, string>> = {
  failed: "Failed",
  waiting: "Waiting for you",
  deferred: "Deferred",
};
const INDEX: Record<Step, number> = {
  idle: -1,
  deciding: 0,
  doing: 1,
  checking: 2,
  done: 3,
  failed: 3,
  waiting: 3,
  deferred: 3,
};

/** "Right now": where he is, what he's doing, why, and what he's thinking. */
export default function RightNow({
  s,
  houseRoom = null,
}: {
  s: Snapshot;
  /** The room the 3D house currently shows him in, so both agree. */
  houseRoom?: RoomId | null;
}) {
  const target = selectScene(worldInput(s, houseRoom));
  const room = ROOMS[target.room];
  const Icon = ROOM_ICON[target.room];
  const latest = s.actions[0] ?? null;
  // Only show live progress and intentions while he is actually working, pondering or waiting on you.
  const live =
    target.activity === "work" ||
    target.activity === "ponder" ||
    target.activity === "wait";
  const current =
    live && latest && s.cycle && latest.cycleId === s.cycle.id ? latest : null;
  const step = actionStep(s.cycle, latest);
  const steps = ["Deciding", "Doing", "Checking", FINAL[step] ?? "Done"];
  return (
    <section className="right-now" aria-label="Right now">
      <div className="right-now-head">
        <span className="room-chip" style={{ background: room.colour }}>
          <Icon size={15} />
        </span>
        <div>
          <span className="eyebrow">Right now</span>
          <strong>
            {room.name} · {activityWords(target)}
          </strong>
        </div>
        {target.label && <span className="world-flag">{target.label}</span>}
        {live && s.cycle && (
          <time className="right-now-time">
            started {ago(s.cycle.createdAt, Date.parse(s.serverTime))}
          </time>
        )}
      </div>
      <dl className="right-now-grid">
        <div>
          <dt>What he’s doing</dt>
          <dd>
            {current?.intention ??
              (live ? s.creature.activity : sentence(activityWords(target)))}
          </dd>
        </div>
        {current?.rationale && (
          <div>
            <dt>Why</dt>
            <dd>{current.rationale}</dd>
          </div>
        )}
        <div>
          <dt>Thinking</dt>
          <dd className="right-now-thought">“{s.creature.thought}”</dd>
        </div>
      </dl>
      {live && step !== "idle" && (
        <ol className={`steps step-${step}`} aria-label="Progress on this step">
          {steps.map((label, i) => (
            <li
              key={label}
              aria-current={i === INDEX[step] ? "step" : undefined}
              data-state={
                i < INDEX[step] ? "past" : i === INDEX[step] ? "now" : "next"
              }
            >
              {label}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
