import { ArrowRight } from "lucide-react";
import type { Snapshot } from "../server/snapshot";
import { BADGE_LABEL, outcomeBadge, stageTrack } from "../world/progress";
import { ago } from "./worldText";

const MAX_DONE = 5;

/** The project his latest action serves: stage track, this stage's tasks, and what he has actually achieved. */
export default function CurrentProject({
  s,
  onOpenProjects,
}: {
  s: Snapshot;
  onOpenProjects: () => void;
}) {
  const latestProjectId = s.actions[0]?.projectId;
  const project =
    s.projects.find((p) => p.id === latestProjectId) ??
    s.projects.find((p) => p.status === "ACTIVE") ??
    null;
  if (!project)
    return (
      <section className="current-project" aria-label="Current project">
        <div className="section-heading">
          <h2>Current project</h2>
        </div>
        <p className="empty-note">
          No project yet. He's still looking for one.
        </p>
      </section>
    );
  const track = stageTrack(project);
  const tasks = project.tasks.filter((t) => t.stage === project.stage);
  const done = (s.projectHistory[project.id] ?? [])
    .map((a) => ({ a, badge: outcomeBadge(a) }))
    .filter(({ badge }) => badge === "verified" || badge === "demo")
    .slice(0, MAX_DONE);
  const currentLabel =
    track.find((t) => t.stage === project.stage)?.label ?? project.stage;
  return (
    <section className="current-project" aria-label="Current project">
      <div className="section-heading">
        <h2>
          Current project <span className="project-name">{project.name}</span>
        </h2>
        <button className="text-button" onClick={onOpenProjects}>
          All projects <ArrowRight size={14} />
        </button>
      </div>
      <p className="project-stage-line">
        Now: <strong>{currentLabel}</strong> · {project.verifiedMilestones}{" "}
        milestone
        {project.verifiedMilestones === 1 ? "" : "s"} so far
      </p>
      <ol className="stage-track" aria-label="Project stages">
        {track.map((t) => (
          <li
            key={t.stage}
            data-state={t.state}
            title={t.state === "demo" ? `${t.label} (demo evidence)` : t.label}
          >
            <span className="stage-dot" aria-hidden="true">
              {t.state === "done" ? "✓" : t.state === "demo" ? "○" : ""}
            </span>
            <span className="stage-label">
              {t.label}
              {t.state === "demo" && <em> demo</em>}
            </span>
          </li>
        ))}
      </ol>
      <div className="project-columns">
        <div>
          <h3>This stage’s to-do</h3>
          {tasks.length ? (
            <ul className="task-list">
              {tasks.map((t) => (
                <li key={t.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={t.status === "DONE"}
                      disabled
                      readOnly
                    />
                    {t.title}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">No tasks planned for this stage yet.</p>
          )}
        </div>
        <div>
          <h3>What he’s actually done</h3>
          {done.length ? (
            <ul className="done-list" aria-label="What he's actually done">
              {done.map(({ a, badge }) => (
                <li key={a.id}>
                  <span className={`badge badge-${badge}`}>
                    {BADGE_LABEL[badge]}
                  </span>
                  <span>{a.outcome?.summary ?? a.intention}</span>
                  <time>{ago(a.createdAt, Date.parse(s.serverTime))}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">Nothing verified yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
