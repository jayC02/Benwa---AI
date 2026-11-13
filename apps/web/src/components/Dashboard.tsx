import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  House,
  Layers3,
  BookOpen,
  Wallet,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  Play,
  Pause,
  Octagon,
  ShieldCheck,
  Sparkles,
  Clock3,
  ChevronRight,
  X,
  Check,
  CircleHelp,
  Activity,
  Leaf,
  FileCode2,
  AlertTriangle,
} from "lucide-react";
import type { Snapshot } from "../server/snapshot";
import World from "./World";
import RightNow from "./RightNow";
import CurrentProject from "./CurrentProject";
import { ROOM_ICON } from "./worldText";
import { ROOMS, roomForTool, type RoomId } from "../world/rooms";
import { BADGE_LABEL, outcomeBadge } from "../world/progress";
import ModelMonitoring from "./ModelMonitoring";
import HumanAssistance from "./HumanAssistance";
import ProgressPanel from "./ProgressPanel";
type Tab = "Home" | "Projects" | "Memories" | "Ledger" | "Settings";
const tabs: { name: Tab; icon: typeof House }[] = [
  { name: "Home", icon: House },
  { name: "Projects", icon: Layers3 },
  { name: "Memories", icon: BookOpen },
  { name: "Ledger", icon: Wallet },
  { name: "Settings", icon: SlidersHorizontal },
];
const money = (v: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    Number(BigInt(v)) / 100,
  );
const words = (v: string) => v.toLowerCase().replaceAll("_", " ");
const time = (v: string) =>
  new Date(v).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const date = (v: string) =>
  new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export default function Dashboard({ initial }: { initial: Snapshot }) {
  const [s, setS] = useState(initial),
    [tab, setTab] = useState<Tab>("Home"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Snapshot["actions"][number] | null>(null),
    [review, setReview] = useState<Snapshot["approvals"][number] | null>(null),
    [houseRoom, setHouseRoom] = useState<RoomId | null>(null);
  async function refresh(signal?: AbortSignal) {
    const r = await fetch("/api/state", { signal });
    if (!r.ok)
      throw new Error(
        r.status === 401
          ? "Your session expired. Reload to sign in."
          : "Cannot reach the workshop. Check the database and web server.",
      );
    setS((await r.json()) as Snapshot);
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let mounted = true;
    async function poll() {
      try {
        await refresh(controller.signal);
        if (mounted) setError("");
      } catch (e) {
        if (mounted && !(e instanceof Error && e.name === "AbortError"))
          setError(e instanceof Error ? e.message : "Connection lost");
      }
      if (mounted)
        timer = setTimeout(() => void poll(), document.hidden ? 20000 : 4000);
    }
    timer = setTimeout(() => void poll(), 4000);
    return () => {
      mounted = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!detail && !review) return;
    const previous = document.activeElement as HTMLElement | null;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetail(null);
        setReview(null);
      }
      if (e.key === "Tab") {
        const elements = [
          ...document.querySelectorAll<HTMLElement>(
            ".modal button,.modal a,.modal input",
          ),
        ].filter((x) => !x.hasAttribute("disabled"));
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    document.querySelector<HTMLElement>(".modal button")?.focus();
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [detail, review]);
  async function mutate(endpoint: string, body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { error?: string; notice?: string };
      if (!r.ok) throw new Error(d.error ?? "Action failed");
      await refresh();
      setMessage(d.notice ?? "Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pending = s.approvals.filter((a) => a.status === "PENDING");
  const running =
    s.creature.status === "RUNNING" || s.creature.status === "RESTING";
  const currentProject = s.projects.find((p) => p.status === "ACTIVE");
  const active = s.projects.filter((p) => p.status === "ACTIVE");
  const recentWarning = s.interventions.find(
    (i) =>
      !i.resolvedAt && (!i.expiresAt || new Date(i.expiresAt) > new Date()),
  );
  function projectList() {
    return s.projects.length ? (
      s.projects.map((p) => (
        <details className="project-row" key={p.id}>
          <summary>
            <div className="project-icon">
              <FileCode2 size={20} />
            </div>
            <div className="project-title">
              <strong>{p.name}</strong>
              <span>
                {words(p.stage)} <span aria-hidden="true">/</span>{" "}
                {p.milestones.length} milestones verified
              </span>
            </div>
            <Pill tone={p.status === "ACTIVE" ? "green" : "neutral"}>
              {words(p.status)}
            </Pill>
            <ChevronRight size={17} />
          </summary>
          <div className="project-expanded">
            <p>{p.description}</p>
            <p className="muted">
              Opportunity scores are uncertain estimates. Demand remains
              unvalidated until an experiment produces independent evidence.
            </p>
            {p.tasks.map((t) => (
              <div className="task" key={t.id}>
                {t.status === "DONE" ? (
                  <Check size={15} />
                ) : (
                  <span className="task-circle" />
                )}
                {t.title}
                <small>{words(t.status)}</small>
              </div>
            ))}
            {p.experiments.map((e) => (
              <blockquote key={e.id}>
                <strong>Experiment</strong>
                <p>{e.hypothesis}</p>
                <small>Success criterion: {e.successCriterion}</small>
              </blockquote>
            ))}
            {s.actions
              .filter(
                (a) =>
                  a.projectId === p.id &&
                  a.tool === "workspace.write" &&
                  a.outcome?.verified,
              )
              .map((a) => (
                <a
                  className="artifact-link"
                  key={a.id}
                  href={`/api/artifact?project=${p.id}&path=${encodeURIComponent(String((a.input as Record<string, unknown>).path))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileCode2 size={15} />
                  {String((a.input as Record<string, unknown>).path)}
                  <ArrowUpRight size={14} />
                </a>
              ))}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  "What changed, or why should this project be suspended? Give a concrete reason (at least 20 characters).",
                );
                if (reason)
                  void mutate("project", {
                    id: p.id,
                    command: p.status === "ACTIVE" ? "suspend" : "reactivate",
                    reason,
                  });
              }}
            >
              {p.status === "ACTIVE"
                ? "Suspend project"
                : "Reactivate with new evidence"}
            </button>
          </div>
        </details>
      ))
    ) : (
      <div className="empty">
        <Layers3 size={26} />
        <p>Every good thing starts somewhere.</p>
        <span>Start Benwa and his first experiment will appear here.</span>
      </div>
    );
  }
  function memoryList() {
    return s.memories.length ? (
      s.memories.map((m) => (
        <article className="memory-item" key={m.id}>
          <div className="memory-meta">
            <BookOpen size={14} />
            <span>{words(m.category)}</span>
            <time>{date(m.createdAt)}</time>
          </div>
          <p>{m.content}</p>
          <span className="tiny">
            {m.simulated
              ? "Demo observation"
              : m.verified
                ? "Recorded observation"
                : "Revisable belief"}
          </span>
        </article>
      ))
    ) : (
      <div className="empty">
        <BookOpen size={26} />
        <p>A fresh little mind.</p>
        <span>Lessons and observations will grow from his work.</span>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Benwa home">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            benwa<small>a little work in progress</small>
          </span>
        </a>
        <div className="sidebar-section">His little world</div>
        <nav aria-label="Main navigation">
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "selected" : ""}
              onClick={() => setTab(name)}
              aria-current={tab === name ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Projects" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
              {name === "Home" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="guard-note">
            <ShieldCheck size={21} />
            <strong>Small steps. Safe boundaries.</strong>
            <p>
              Benwa explores on his own. You have the final say on the big
              things.
            </p>
          </div>
          <div className="connection">
            <span className={`live-dot ${s.workerOnline ? "on" : ""}`} />
            <span>
              {s.workerOnline ? "Worker connected" : "Worker offline"}
            </span>
            <span className="tiny">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Benwa’s world <ChevronRight size={14} />
            <strong>{tab === "Home" ? "Overview" : tab}</strong>
          </span>
          <div className="topbar-right">
            <Pill tone={s.configuration.mode === "demo" ? "amber" : "blue"}>
              {s.configuration.mode === "demo" ? "Demo mode" : "Real provider"}
            </Pill>
            <span className="local-badge">
              <span className="live-dot on" />
              Private workshop
            </span>
            <button
              className="help-button"
              aria-label="About this workshop"
              onClick={() => {
                setMessage(
                  "Benwa works independently of this browser. Demo research is synthetic, file outputs are real, and revenue only comes from trusted ledger records. External publishing and spending are disabled.",
                );
              }}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <div className="greeting">
                <Leaf size={15} />{" "}
                {tab === "Home"
                  ? "A little ambition, every day"
                  : "Inside the workshop"}
              </div>
              <h1>
                {tab === "Home"
                  ? "Hello, Benwa."
                  : tab === "Projects"
                    ? "Ideas becoming things."
                    : tab === "Memories"
                      ? "A mind that keeps growing."
                      : tab === "Ledger"
                        ? "Every penny, accounted for."
                        : "Room to find his rhythm."}
              </h1>
              <p>
                {tab === "Home"
                  ? "A curious little creature, making his own way in the world."
                  : tab === "Projects"
                    ? "His experiments, the evidence, and what happens next."
                    : tab === "Memories"
                      ? "What he has observed, learned, and might change his mind about."
                      : tab === "Ledger"
                        ? "Verified transactions only. Possibilities don’t pay the bills."
                        : "You set the boundaries. Benwa chooses the next useful step."}
              </p>
            </div>
            <div className="heading-control">
              <Pill
                tone={
                  running
                    ? "green"
                    : s.creature.status === "STOPPED"
                      ? "red"
                      : "neutral"
                }
              >
                <span className={`live-dot ${running ? "on" : ""}`} />
                {s.creature.status === "RESTING"
                  ? "waiting"
                  : words(s.creature.status)}
              </Pill>
              <button
                className="control-button"
                disabled={busy || !s.workerOnline}
                aria-describedby={
                  pending.length ? "pending-review-notice" : undefined
                }
                onClick={() =>
                  void mutate("control", {
                    command: running ? "pause" : "start",
                  })
                }
              >
                {running ? <Pause size={16} /> : <Play size={16} />}{" "}
                {running ? "Pause" : "Start Benwa"}
              </button>
            </div>
          </div>
          {pending.length > 0 && (
            <div className="notice" id="pending-review-notice">
              <ShieldCheck size={17} />
              <span>
                {pending.length} request
                {pending.length === 1 ? " needs" : "s need"} your review. Start
                Benwa to continue other local work while{" "}
                {pending.length === 1 ? "it waits" : "they wait"}.
              </span>
              <button
                className="text-button"
                onClick={() => setReview(pending[0])}
              >
                Review request
              </button>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              <Check size={17} />
              <span>{message}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {s.configuration.mode === "demo" && (
            <div className="demo-note">
              <Sparkles size={15} />
              <span>
                A safe first adventure. Decisions and research are scripted;
                project files, checks, memory, and approvals are real.
              </span>
              <button onClick={() => setTab("Settings")}>
                About real mode <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {tab === "Home" && <ProgressPanel creature={s.creature} />}
          {tab === "Home" && (
            <div className="dashboard-grid">
              <div className="main-column">
                <section aria-label="Benwa’s habitat">
                  <div className="creature-heading">
                    <h2>
                      One small creature.
                      <br />
                      <span>A world of possibilities.</span>
                    </h2>
                    <span className="creature-tag">
                      <span className="mini-face">•ᴗ•</span> Meet your little
                      entrepreneur
                    </span>
                  </div>
                  <World s={s} onRoom={setHouseRoom} />
                </section>
                <RightNow s={s} houseRoom={houseRoom} />
                <CurrentProject
                  s={s}
                  onOpenProjects={() => setTab("Projects")}
                />
                <section className="activity-section">
                  <div className="section-heading">
                    <h2>A day in his life</h2>
                    <span className="tiny">
                      <span className="live-dot on" /> Updates every few seconds
                    </span>
                  </div>
                  {s.actions.length ? (
                    <div className="timeline">
                      {s.actions.slice(0, 8).map((a) => (
                        <button
                          className="timeline-row"
                          key={a.id}
                          onClick={() => setDetail(a)}
                        >
                          <FeedIcon
                            tool={a.tool}
                            failed={a.status === "FAILED"}
                          />
                          <div>
                            <strong>{a.outcome?.summary ?? a.intention}</strong>
                            <span>
                              <FeedBadge action={a} />{" "}
                              <span className="feed-tool">{a.tool}</span>
                            </span>
                          </div>
                          <time>{time(a.createdAt)}</time>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="feed-empty">
                      <Clock3 size={21} />
                      <div>
                        <strong>The first page is still blank.</strong>
                        <p>
                          When Benwa gets started, you can follow every action
                          here.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              </div>
              <aside className="right-column">
                <section className="pocket">
                  <div className="section-heading">
                    <h2>His little nest egg</h2>
                    <Wallet size={18} />
                  </div>
                  <div className="profit">
                    <span>Realised net profit</span>
                    <strong>{money(s.finance.net)}</strong>
                    <Pill tone="green">
                      <ShieldCheck size={12} /> Verified ledger
                    </Pill>
                  </div>
                  <div className="finance-line">
                    <span>Gross revenue</span>
                    <strong>{money(s.finance.revenue)}</strong>
                  </div>
                  <div className="finance-line">
                    <span>All recorded costs</span>
                    <strong>{money(s.finance.expenses)}</strong>
                  </div>
                  <div className="finance-line sub">
                    <span>Including recorded API costs</span>
                    <span>{money(s.finance.api)}</span>
                  </div>
                  <p className="finance-disclaimer">
                    {s.finance.transactions.length
                      ? "Based on recorded receipts and costs. Reconcile all fees and invoices before relying on net profit."
                      : "No verified payments yet. His first real sale will mean something."}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setTab("Ledger")}
                  >
                    Open the ledger <ArrowRight size={14} />
                  </button>
                </section>
                <section className="supervisor-panel">
                  <div className="section-heading">
                    <h2>A watchful eye</h2>
                    <ShieldCheck size={19} />
                  </div>
                  <div
                    className={`supervisor-indicator ${recentWarning ? "warning" : ""}`}
                  >
                    <span className="status-circle">
                      {recentWarning ? (
                        <AlertTriangle size={18} />
                      ) : (
                        <Check size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {recentWarning
                          ? "A little course correction"
                          : s.supervisorOnline
                            ? "Keeping him on track"
                            : "Cycle safeguards active"}
                      </strong>
                      <span>
                        {recentWarning
                          ? `Supervisor level ${recentWarning.level}`
                          : s.supervisorOnline
                            ? "Independent supervisor connected"
                            : "Independent monitor offline"}
                      </span>
                    </div>
                  </div>
                  <p>
                    {recentWarning?.reason ??
                      "Making sure curiosity turns into progress, and he doesn’t run around in circles."}
                  </p>
                  <div className="boundary">
                    <span>External spending</span>
                    <strong>
                      {s.autonomyMode === "independent"
                        ? "Disabled · £0 limit"
                        : "Approval required"}
                    </strong>
                  </div>
                  <div className="boundary">
                    <span>Publishing & outreach</span>
                    <strong>
                      {s.autonomyMode === "independent"
                        ? "Deferred until connected"
                        : "Approval required"}
                    </strong>
                  </div>
                  {recentWarning && (
                    <details>
                      <summary>Inspect interventions</summary>
                      {s.interventions.map((i) => (
                        <p key={i.id}>
                          {date(i.createdAt)} · Level {i.level}: {i.reason}
                        </p>
                      ))}
                    </details>
                  )}
                </section>
                <section className="approval-panel">
                  <div className="section-heading">
                    <h2>
                      A word with you{" "}
                      <span className="count">{pending.length}</span>
                    </h2>
                    <ShieldCheck size={18} />
                  </div>
                  {pending.length ? (
                    pending.map((a) => (
                      <button
                        className="approval-item"
                        key={a.id}
                        onClick={() => setReview(a)}
                      >
                        <span className="approval-dot" />
                        <div>
                          <strong>{words(a.kind)} review</strong>
                          <span>{a.description.slice(0, 110)}</span>
                        </div>
                        <ChevronRight size={15} />
                      </button>
                    ))
                  ) : (
                    <div className="quiet-approval">
                      <div className="envelope">✓</div>
                      <strong>Nothing needs your say.</strong>
                      <p>
                        {s.autonomyMode === "independent"
                          ? "He continues local work and saves unavailable external steps for later."
                          : "He’ll check with you before taking a consequential step."}
                      </p>
                    </div>
                  )}
                </section>
                <HumanAssistance
                  items={s.assistance}
                  busy={busy}
                  mutate={mutate}
                />
                <section className="memory-preview">
                  <div className="section-heading">
                    <h2>Little things he’s learned</h2>
                    <BookOpen size={17} />
                  </div>
                  {s.memories[0] ? (
                    <>
                      <p className="memory-quote">{s.memories[0].content}</p>
                      <span className="tiny">
                        {s.memories[0].simulated
                          ? "Demo observation"
                          : s.memories[0].verified
                            ? "Recorded observation"
                            : "Revisable belief"}
                      </span>
                    </>
                  ) : (
                    <p>
                      Every attempt leaves a lesson. His first one is just
                      around the corner.
                    </p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setTab("Memories")}
                  >
                    Explore his memory <ArrowRight size={14} />
                  </button>
                </section>
              </aside>
            </div>
          )}
          {tab === "Projects" && (
            <section className="wide-panel">
              <div className="section-heading">
                <h2>The experiment shelf</h2>
                <span className="tiny">
                  {s.projects.length} projects recorded
                </span>
              </div>
              {projectList()}
              {currentProject && (
                <p className="muted section-footnote">
                  Most productive effort goes to the strongest active
                  experiment. Every fifth decision considers exploration.
                </p>
              )}
            </section>
          )}
          {tab === "Memories" && (
            <section className="wide-panel">
              <div className="section-heading">
                <h2>Notes to his future self</h2>
                <span className="tiny">
                  Full action histories remain in the audit log
                </span>
              </div>
              <div className="memory-list">{memoryList()}</div>
            </section>
          )}
          {tab === "Ledger" && (
            <Ledger snapshot={s} busy={busy} mutate={mutate} />
          )}
          {tab === "Settings" && (
            <SettingsPanel snapshot={s} busy={busy} mutate={mutate} />
          )}
          <footer>
            <span>
              <span className="mini-face">•ᴗ•</span> Small experiments. Honest
              progress.
            </span>
            <div>
              <span>
                {s.workerOnline
                  ? "His work continues when you close this page."
                  : "Start the worker to bring the workshop online."}
              </span>
              <button
                className="emergency-stop"
                disabled={busy || s.creature.status === "STOPPED"}
                onClick={() => void mutate("control", { command: "stop" })}
              >
                <Octagon size={13} /> Emergency stop
              </button>
            </div>
          </footer>
        </main>
      </div>
      {(detail || review) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDetail(null);
            setReview(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2 id="modal-title">
                {review ? "A step that needs your say" : "Inspect the evidence"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => {
                  setDetail(null);
                  setReview(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            {detail && (
              <>
                <Pill tone={detail.outcome?.verified ? "green" : "amber"}>
                  {words(detail.status)}
                </Pill>
                <h3>{detail.intention}</h3>
                <p>{detail.rationale}</p>
                <dl>
                  <dt>Tool</dt>
                  <dd>{detail.tool}</dd>
                  <dt>Expected evidence</dt>
                  <dd>{detail.expectedEvidence}</dd>
                  <dt>Observed result</dt>
                  <dd>
                    {detail.outcome?.summary ?? "No executed result yet."}
                  </dd>
                  <dt>Verification</dt>
                  <dd>
                    {detail.outcome?.simulated
                      ? "Demo evidence."
                      : detail.outcome?.meaningful
                        ? "Successful, novel tool evidence. This does not prove demand or commercial value."
                        : "No verified new outcome."}
                  </dd>
                </dl>
                <h3>Input</h3>
                <pre>{JSON.stringify(detail.input, null, 2)}</pre>
                <h3>Evidence</h3>
                <pre>
                  {JSON.stringify(detail.outcome?.evidence ?? {}, null, 2)}
                </pre>
                {detail.executions.map((e) => (
                  <p key={e.id} className={e.error ? "error-text" : "tiny"}>
                    {e.error ?? `${e.status} at ${time(e.startedAt)}`}
                  </p>
                ))}
                <span className="tiny">Action {detail.id}</span>
              </>
            )}
            {review && (
              <>
                <Pill tone="amber">{words(review.kind)}</Pill>
                <h3>{review.action.intention}</h3>
                <p className="pre-wrap">{review.description}</p>
                <h3>Exact proposed payload</h3>
                <pre>{JSON.stringify(review.action.input, null, 2)}</pre>
                <p>
                  Estimated cost: {money(review.action.costEstimateMinor)}.
                  Expires {date(review.expiresAt)} at {time(review.expiresAt)}.
                </p>
                <div className="notice">
                  Approval records consent to this preparation. No external
                  executor is connected, so this button does not publish, send,
                  buy, or transfer anything.
                </div>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await mutate("approval", {
                          id: review.id,
                          decision: "REJECTED",
                        })
                      )
                        setReview(null);
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await mutate("approval", {
                          id: review.id,
                          decision: "APPROVED",
                        })
                      )
                        setReview(null);
                    }}
                  >
                    <Check size={16} /> Record approval
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
type Mutate = (endpoint: string, body: unknown) => Promise<boolean>;
function Ledger({
  snapshot: s,
  busy,
  mutate,
}: {
  snapshot: Snapshot;
  busy: boolean;
  mutate: Mutate;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const data = {
      externalId: String(f.get("referenceId")),
      kind: String(f.get("kind")),
      amountMinor: String(f.get("amountMinor")),
      currency: "GBP",
      source: "human",
      evidence: { reference: String(f.get("evidence")) },
      projectId: String(f.get("projectId") ?? "") || undefined,
    };
    if (await mutate("finance", data)) form.reset();
  }
  return (
    <>
      <section className="ledger-summary">
        {[
          { label: "Gross revenue", value: s.finance.revenue },
          { label: "Recorded costs", value: s.finance.expenses },
          { label: "Realised net profit", value: s.finance.net },
          { label: "API costs recorded", value: s.finance.api },
        ].map((m) => (
          <div key={m.label}>
            <span>{m.label}</span>
            <strong>{money(m.value)}</strong>
          </div>
        ))}
      </section>
      <div className="two-columns">
        <section className="wide-panel">
          <h2>The paper trail</h2>
          <p className="muted">
            Only trusted, independently evidenced GBP transactions belong here.
            Record fees, refunds, hosting, and API invoices to keep profit
            accurate.
          </p>
          {s.finance.transactions.length ? (
            <div className="transaction-list">
              {s.finance.transactions.map((t) => (
                <div key={t.id}>
                  <span>
                    <strong>{words(t.kind)}</strong>
                    <small>
                      {t.externalId} · {date(t.createdAt)}
                    </small>
                  </span>
                  <strong>
                    {t.kind === "REVENUE" ? "+" : "−"}
                    {money(t.amountMinor)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Wallet size={28} />
              <p>£0 is an honest starting point.</p>
              <span>
                Invoices, forecasts, and test payments never count as sales.
              </span>
            </div>
          )}
        </section>
        <section className="wide-panel">
          <h2>Record a verified transaction</h2>
          <p className="muted">
            A trusted operator action. Use a real receipt, settled payment, or
            invoice. All amounts are integer pence.
          </p>
          <form className="settings-form" onSubmit={(e) => void submit(e)}>
            <label>
              Type
              <select name="kind">
                <option value="REVENUE">Settled revenue</option>
                <option value="REFUND">Refund</option>
                <option value="FEE">Payment / platform fee</option>
                <option value="API_COST">API invoice</option>
                <option value="HOSTING">Hosting</option>
                <option value="EXPENSE">Other expense</option>
              </select>
            </label>
            <label>
              Amount in pence (GBP)
              <input
                name="amountMinor"
                type="number"
                min="1"
                max="999999999999"
                step="1"
                required
                placeholder="e.g. 500 = £5.00"
              />
            </label>
            <label>
              Unique transaction reference
              <input
                name="referenceId"
                minLength={4}
                maxLength={200}
                required
                placeholder="bank-receipt-123"
              />
            </label>
            <label>
              Independent evidence reference
              <input
                name="evidence"
                minLength={5}
                maxLength={1000}
                required
                placeholder="Receipt URL or bank statement reference"
              />
            </label>
            <label>
              Attributable project
              <select name="projectId">
                <option value="">General / shared cost</option>
                {s.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              Record verified transaction
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
function SettingsPanel({
  snapshot: s,
  busy,
  mutate,
}: {
  snapshot: Snapshot;
  busy: boolean;
  mutate: Mutate;
}) {
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await mutate("settings", {
      cycleSeconds: Number(f.get("cycleSeconds")),
      maxSteps: Number(f.get("maxSteps")),
      restSeconds: Number(f.get("restSeconds")),
      dailyTokenLimit: Number(f.get("dailyTokenLimit")),
      maxProjects: Number(f.get("maxProjects")),
      authorisedMinor: String(f.get("authorisedMinor")),
    });
  }
  return (
    <>
      <ModelMonitoring models={s.models} />
      <div className="two-columns">
        <section className="wide-panel">
          <h2>A sustainable pace</h2>
          <form className="settings-form" onSubmit={(e) => void save(e)}>
            <label>
              Seconds between decisions
              <input
                name="cycleSeconds"
                type="number"
                min={5}
                max={3600}
                defaultValue={s.configuration.cycleSeconds}
                required
              />
            </label>
            <label>
              Actions between memory checkpoints
              <input
                name="maxSteps"
                type="number"
                min={1}
                max={200}
                defaultValue={s.configuration.maxSteps}
                required
              />
            </label>
            <label>
              Minimum idle wait in seconds
              <input
                name="restSeconds"
                type="number"
                min={30}
                max={3600}
                defaultValue={s.configuration.restSeconds}
                required
              />
            </label>
            <label>
              Daily model token ceiling (resets at 00:00 UTC)
              <input
                name="dailyTokenLimit"
                type="number"
                min={0}
                max={10000000}
                defaultValue={s.configuration.dailyTokenLimit}
                required
              />
            </label>
            <label>
              Maximum active projects
              <input
                name="maxProjects"
                type="number"
                min={1}
                max={5}
                defaultValue={s.configuration.maxProjects}
                required
              />
            </label>
            <label>
              Authorised daily external budget in pence
              <input
                name="authorisedMinor"
                type="number"
                min={0}
                max={999999999}
                defaultValue={s.budget?.authorisedMinor ?? "0"}
                required
              />
              <small>
                Every spend still requires action-specific approval. No external
                spending executor is enabled.
              </small>
            </label>
            <button className="primary" disabled={busy}>
              Save boundaries
            </button>
          </form>
        </section>
        <div>
          <section className="wide-panel">
            <h2>Where his ideas come from</h2>
            <div className="provider-details">
              <div>
                <span>Mode</span>
                <Pill tone="amber">{s.configuration.mode}</Pill>
              </div>
              <div>
                <span>Provider credentials</span>
                <strong>
                  {s.providerConfigured ? "Configured" : "Not configured"}
                </strong>
              </div>
              <div>
                <span>Source search</span>
                <strong>
                  {s.searchProvider === "langsearch"
                    ? "LangSearch · general web"
                    : s.searchProvider === "public"
                      ? "Free public sources"
                      : s.searchConfigured
                        ? "Brave configured"
                        : "Not configured"}
                </strong>
              </div>
              <div>
                <span>Web access</span>
                <strong>
                  {s.webAccess === "public"
                    ? "Public websites"
                    : "Approved websites"}
                </strong>
              </div>
              <div>
                <span>Autonomy</span>
                <strong>
                  {s.autonomyMode === "independent"
                    ? "Independent local work"
                    : "Supervised"}
                </strong>
              </div>
              <div>
                <span>Tokens used today</span>
                <strong>{s.budget?.tokensUsed ?? 0}</strong>
              </div>
              <div>
                <span>Tokens spent or reserved</span>
                <strong>{s.budget?.tokensReserved ?? 0}</strong>
              </div>
            </div>
            <p>
              {s.models.provider === "gemini" ? (
                <>
                  Gemini routing uses the server-side key, verified model
                  capabilities, configured quotas and the unbilled project
                  check. Run <code>npm run models:verify -- --probe</code> to
                  validate access. Set <code>AGENT_MODE=real</code> to use it
                  for agent decisions.
                </>
              ) : (
                <>
                  To use a real model, set <code>AGENT_MODE=real</code>,{" "}
                  <code>LLM_API_KEY</code>, and <code>LLM_MODEL</code> in the
                  server environment and restart.
                </>
              )}
            </p>
            <p>
              Free discovery searches Wikipedia and Hacker News. Benwa can read
              public source pages and follow their links. This covers fewer
              sources than a full web search engine.
            </p>
          </section>
          <section className="wide-panel guardrails">
            <ShieldCheck size={25} />
            <h2>
              A little independence.
              <br />
              Clear boundaries.
            </h2>
            <p>
              Generated code runs in a networkless Docker sandbox with memory,
              CPU, process, and time limits. Without Docker, code execution
              reports an error.
            </p>
            <p>
              Benwa cannot edit his ledger, emotional engine, permissions, or
              supervisor. Public launches, outreach, purchases, and transfers
              always need review.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void mutate("control", { command: "stop" })}
            >
              <Octagon size={15} /> Emergency stop
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
function FeedIcon({ tool, failed }: { tool: string; failed: boolean }) {
  const room = roomForTool(tool);
  const Icon = room ? ROOM_ICON[room] : Activity;
  return (
    <span
      className={`timeline-icon ${failed ? "failed" : ""}`}
      style={room ? { background: ROOMS[room].colour } : undefined}
      title={room ? ROOMS[room].name : undefined}
    >
      <Icon size={16} />
    </span>
  );
}
function FeedBadge({ action }: { action: Snapshot["actions"][number] }) {
  const badge = outcomeBadge(action);
  return <span className={`badge badge-${badge}`}>{BADGE_LABEL[badge]}</span>;
}
