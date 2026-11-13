# Benwa runtime boundaries

The creature is a constrained decision maker, not a privileged process. An OpenAI-compatible Chat Completions adapter requests one `choose_action` tool call per cycle. Zod validates the envelope and the selected tool input. A deterministic demo provider uses the same persistence and execution path, with synthetic research explicitly marked `simulated`.

The simulation, supervisor, queue and ledger are separate core modules. A separate supervisor process also checks elapsed stagnation, recorded cost per outcome and worker heartbeat gaps, writes failure reports, and enforces suspension/review without calling the model. The tool registry does not expose their configuration, database access, financial writes, host commands or credentials. Generated code only runs as a non-root user in a read-only, networkless Docker container. Only the selected project's read-only directory and a trusted runner are mounted. Docker sockets, `.env`, runtime source and the database are never mounted. File tools restrict paths, reject links and limit file types and sizes.

## State machine and recovery

`DECIDING → VALIDATING → EXECUTING → VERIFYING → DONE`, or `AWAITING_APPROVAL`.

`ScheduledJob` has a unique recurring key, generation number, expiring lease and random fencing token. Claims use PostgreSQL `UPDATE ... FOR UPDATE SKIP LOCKED`. A separate heartbeat renews leases while the model or a tool is running. Expired leases can be reclaimed. A cycle is unique for each job generation, and each cycle owns exactly one action. Recovered completed tool outputs are reused; interrupted code executions become explicit unknown outcomes instead of being silently repeated. Plans, milestone transitions and writes are idempotent. Outcome creation, emotion changes, audit memory and the completed checkpoint commit together.

The worker checks persistent control state before decision and execution. Emergency stop prevents the next tool and removes active sandbox containers within the heartbeat interval. Already completed local writes and in-flight read requests remain auditable. Pause takes effect at safe boundaries. Graceful shutdown lets a bounded in-flight cycle settle, kills its sandbox and disconnects.

## Verification and anti-loop policy

Tool evidence is observed by trusted runtime code: source body hashes, file read-back hashes, persisted plans, exact static checks, sandbox exit status and browser errors. Successful novel evidence can advance the simulation. Hash identity excludes mutable source URLs and artifact paths when a content hash exists. Reading a file, self-authored memories and resting never generate progress rewards. A write verifies bytes, not software correctness or commercial demand. Static inspection is displayed as static inspection; only executed sandbox/browser checks can advance TESTING to LAUNCH_APPROVAL.

Fingerprints, canonical target and strategy comparison, intention token overlap and observed outcomes detect stagnant attempts. Useful repeated outputs break a stagnant sequence. Repetition warns, three stagnant attempts block an approach for thirty minutes, six outcomes without progress suspend a project, and multiple suspended projects trigger review. Failure reports preserve the failed approach, last observation and reconsideration conditions. The current similarity heuristic is lexical, not a semantic embedding model; paraphrases and superficial code edits remain an area for improvement.

## Budgets and accounting

Money uses integer `BigInt` minor units, currently GBP only. A database constraint enforces positive amounts and supported currency; a trigger rejects ledger updates and deletes. Entries are only created by authenticated human routes or a trusted integration API, never by the creature. Financial summaries subtract refunds, payment fees and every recorded expense. First-sale rewards require aggregate recorded net profit to be positive. Unrecorded bills are an accounting completeness limitation, not assumed free infrastructure.

Stripe webhooks verify HMAC signatures, timestamp tolerance and live GBP settled-payment events. They stage authentic gross receipts as pending reconciliation memories; they do not credit revenue automatically. The operator must reconcile settlement, fees and refunds and record verified ledger entries. Test payments never count. The MVP has no automatic invoice, fee, FX or bank reconciliation.

Model calls conservatively reserve the configured maximum input and output token allowance atomically. Successful usage replaces the current reservation with actual returned usage. Failed or ambiguous calls retain reservations; bounded retries reserve again. Prompt bytes bound the input conservatively, and memory/context is reduced before submitting when needed. The daily UTC ceiling pauses execution until the next period. Token usage is not a verified API invoice: API financial costs are recorded from invoices by the operator. A daily external budget is recorded, initially zero, but no automated spending adapter is enabled regardless of that amount.

## Persistence and deployment

Production uses PostgreSQL and Prisma migrations. Supabase connections use the private backend database role, with RLS enabled and no public Data API policies. Disable the Data API for this database if it is unnecessary. Keep service credentials server-side. Separate direct/session-pooler URLs can be used for migrations. Back up PostgreSQL and the project workspace together.

Disk-backed PGlite is a local development convenience on hosts without Docker. Its single underlying session is multiplexed; local URLs disable prepared-statement caching and enable PgBouncer compatibility to avoid statement-name conflicts between processes. It has no network authentication and binds only to loopback. Use normal PostgreSQL for deployment, load, process isolation, and production lock semantics.

The web application uses an HttpOnly, SameSite Strict session and origin checks for mutations. Loopback development automatically issues a local session. Non-loopback hosting requires a dashboard password and persistent session secret. Untrusted artifacts are served as plain text with a sandbox CSP. A reverse proxy should enforce request-body limits, HTTPS and authentication before public exposure. The dashboard is single-operator software, not a multi-tenant application.

## Benwa's house (dashboard view)

The supplied `sprout_creature_3d.glb` is preserved unchanged at `apps/web/public/models/benwa.glb`: 271,196 bytes, 18 separate meshes, no textures, no compression decoders and no authored animation clips. Source coordinates are Z-up with the face along +X.

The Home tab shows Benwa in a low-poly dollhouse (`apps/web/src/world/`, rendered by `components/World.tsx`): seven rooms on two floors plus an attic, joined by a ladder tower, with the front wall cut away. Room choice is a pure function, `selectScene`, of persisted state: an offline worker always shows him asleep; review/error states show him confused where he stands; pending approvals or assistance requests put him in the front hall; resting/paused states put him in the bedroom; otherwise the latest action's tool picks the room, and he only "works" while that action is executing in the current cycle. Between actions he ponders in the last room, so the view never shows finished work as ongoing. `snapshot.ts` adds read-only queries for the latest cycle, per-project and per-room action history, and whether each milestone rests on simulated evidence.

Animation is procedural: `rig.ts` re-parents limb meshes under pivots at hips, shoulders, eyes and the leaf stem, and `animations.ts` poses them per activity (walk, climb, type, read, tinker, pin, write, post, wait, sleep, sit, ponder, confused, plus hop/slump/dance reactions). Reactions come from comparing consecutive snapshots and never fire for simulated evidence or on first load. Motion pauses for hidden/offscreen views, snaps instead of walking under reduced motion or when paused, and releases GPU resources on unmount. `data-model-state="ready"` is only set after a frame containing Benwa has been drawn; earlier screenshots that seemed to show no creature were captured before such a frame, not a model fault. Loading, WebGL failure and retry keep HTML fallbacks that still state his room and activity.
