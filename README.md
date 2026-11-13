# Benwa

A persistent little digital entrepreneur, with your supplied sprout model as his face. Benwa chooses an objective, uses real tools, preserves evidence, and learns from outcomes. A deterministic emotional engine and an independent supervisor govern the simulation. The browser observes his work; it does not run the agent.

## Run locally

For free password-protected phone access while this PC stays awake, see [the phone setup](docs/PHONE.md). Double-click **Start Benwa Phone.cmd** after the initial setup.

Requires **Node.js 24** and npm. Docker is optional for the dashboard and local database, and **required for generated-code execution and controlled browser tests**.

From the repository root:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:generate
npm run dev
```

On macOS/Linux, use `cp .env.example .env` instead. Open **http://127.0.0.1:4321** and select **Start Benwa**. The development launcher starts a disk-backed local PostgreSQL engine on port 54329 when the example database URL is used, applies migrations, initialises Benwa, and starts independent web and worker processes. It creates no fake financial records or activity. Local data lives in `.data/`; keep it to preserve his memories.

The default is explicitly labelled **demo mode**. It uses scripted decisions and synthetic research, creates a real dependency-ordered plan and validation brief, writes a working HTML break-even calculator, reads back its bytes, performs static checks, and stops at a review request. The calculator's demand is unvalidated. No revenue or executed browser test is invented. All dashboard content comes from the database.

To run the processes separately:

```text
npm run db:local
npm run db:migrate
npm run db:seed
npm run worker
npm run supervisor
npm run dev:web
```

Keep `db:local`, `worker`, `supervisor`, and `dev:web` in separate terminals. `npm run dev` starts all four for you. Close the browser and the worker continues. A stopped worker resumes the durable queue after its lease expires (at most 90 seconds). An idle worker still emits a heartbeat; the UI reports it offline after fifteen seconds without one. The independent supervisor checks elapsed stagnation, recorded cost per meaningful outcome and worker heartbeat gaps, and can suspend projects or require review without asking the model.

## Use a real model

For the new official-SDK Gemini multi-model router, free-tier setup, live model results, shared quota rules and human-help queue, see [the Gemini integration guide](docs/GEMINI.md). The OpenAI-compatible setup below is retained for backward compatibility; Gemini never uses it as a fallback.

Set these **server-side** values in `.env`, then restart the worker and web application:

```dotenv
AGENT_MODE=real
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-provider-key
LLM_MODEL=your-tool-calling-model
LLM_MAX_INPUT_TOKENS=32000
LLM_MAX_OUTPUT_TOKENS=2400
```

The adapter implements OpenAI-compatible Chat Completions with a required function tool call, validated by Zod. There is no automatic fallback to fake reasoning when a real provider fails. Other compatible endpoints can be configured. The operator authorises provider calls by configuring credentials and starting real mode; token limits apply separately from external purchases. Token ceilings are conservative: input UTF-8 bytes bound the submitted prompt, and actual returned usage is tracked. Adjust the dashboard's daily ceiling to cover at least one maximum reservation. Failed/ambiguous requests retain reservations, bounded retries reserve again, and the day resets at **00:00 UTC**. Monetary API invoices are recorded separately from token usage.

Add `BRAVE_SEARCH_KEY` for live search. Without it, Benwa can retrieve known public URLs on `RESEARCH_HOSTS`. The initial hosts are MDN, Wikipedia and Python documentation. Exact HTTPS host allowlisting, pinned public IPv4 DNS resolution, robots rules, timeouts, response size limits, no redirect following, and per-host throttling constrain research. A missing/unreachable robots file fails closed. Expand the operator-owned host list only for sources you permit. Website contents remain untrusted observations and cannot grant permissions.

## Execute generated code safely

Install/start Docker Desktop (Linux containers) or Docker Engine, then build the fixed sandbox image:

```text
docker build -t benwa-sandbox:local sandbox
```

`sandbox.run` supports only `node <file>` and `node --test <file>`. `browser.test` uses Playwright inside the same networkless sandbox to serve and inspect project HTML. The image includes the matching browser build. Limits: 45-second execution, 0.5 CPU, 512 MiB memory, 128 processes, bounded output, non-root user, no capabilities, no new privileges, read-only root and project, and limited temporary storage. No runtime code, credentials, database or host Docker socket is mounted. Local source files are written by constrained file tools, then mounted read-only for execution. Browser checks currently load HTML, detect JS exceptions and record a screenshot hash; project-specific interaction assertions belong in generated Node tests.

When Docker or its image is missing, the action records the real error and Benwa can choose another approach. **There is no host execution fallback.** Dependency downloads during generated-code execution are disabled; the MVP targets self-contained Node/HTML assets and preinstalled tools.

## Boundaries, approvals and finances

- Start, pause, resume through Start, and emergency stop are persisted controls. Emergency stop blocks subsequent actions and removes active sandbox containers within the worker's heartbeat interval. In-flight local writes or public reads may finish and remain in the audit history.
- Spending begins at zero. The dashboard configures a daily external budget, but every positive-cost action still requires specific review. **No purchase, transfer, trading, advertising, outreach, paid-account, contract or publishing executor is enabled.** Approval records consent to the exact prepared payload; it does not perform the external action. Approved preparations remain available in the database. A public operation stage is deliberately blocked until an executor and launch evidence are integrated.
- Only authenticated operator actions can enter verified GBP revenue or costs. Use the Ledger form with real receipt/settlement references, and record all fees, refunds, hosting, API invoices and other attributable expenses. Integer pence prevent floating-point accounting errors. Entries are append-only and external references deduplicate submissions. The creature has no ledger-writing tool.
- `POST /api/stripe` is a signed-webhook extension point. `STRIPE_WEBHOOK_SECRET` enables signature/timestamp checks and live GBP receipt staging. Test payments are ignored. Even genuine gross receipts stay **outside revenue** until settlement, fees and refunds are reconciled by the operator. Automatic settlement, refund and invoice reconciliation are not implemented.
- Net profit means revenue less **recorded** refunds and costs, not guaranteed completeness of your bookkeeping. No real payment provider or invoices were connected during this build; verified revenue remains £0.

Happiness is feedback on outcomes, stored in the existing `mood` field. Verified novel progress on the current objective raises it (discovery +2, milestones +3 by default); failed actions lower it (-2), and repetitive or stagnant approaches incur stronger penalties (-10/-20). Search leads, repeated evidence, ordinary work and waiting do not earn happiness. Each action outcome and its memory record explain the signal, score change and reason; the next decision receives this feedback. This guides model choices through context and does not retrain model weights. Tiredness is disabled: work never drains energy, low happiness never forces sleep, and legacy emotional fields remain stored for compatibility without driving decisions. The dashboard displays Happiness and skill ratings near the top, above the house. `maxSteps` now controls deterministic memory checkpoints while work continues; `restSeconds` controls the minimum idle wait only when actionable work is unavailable. Quota cooldowns, budget limits and operator controls still apply.

Repetition produces a warning and a happiness penalty five times the basic discovery reward. Three stagnant attempts block an approach, six outcomes without progress suspend its project, and multiple suspended projects pause the system for review. Verified productive repetition is permitted. Internal replanning earns progress only once per project stage. Forward file-read continuations and legitimate idle waits do not count as stagnation or earn progress rewards. The supervisor uses deterministic fingerprints, canonical target/strategy comparison, lexical intention similarity, artifact/source hashes and structured outcomes; it does not use an LLM to certify its own claims. It is a useful MVP guard, not a proof of economic value or a perfect semantic loop detector.

Skill ratings (Coding, Intelligence, Creativity, Research, Testing, Planning, Business and Adaptability) are stored in the existing creature row. Verified novel outcomes award relevant points; failures subtract relevant points. Creativity comes from useful new saved plans and artifacts. Successful strategy changes after failures earn Adaptability. Ordinary notes do not earn Coding points; repeated outputs, searches and waiting do not farm skill XP. Ratings are bounded from 0 to 100, persisted atomically with outcomes, and initialized once from existing recorded action history. These are game progress ratings, not model benchmarks.

The independent monitor also suspends projects after three stagnant attempts plus `SUPERVISOR_STAGNANT_SECONDS` (default one hour), or when recorded project costs exceed `SUPERVISOR_MAX_COST_PER_OUTCOME_MINOR` (default £10) per meaningful outcome. Assign costs to a project in the Ledger form. These thresholds are review limits, not authorisation to spend.

Project lifecycle: discovery → research → validation → planning → building → testing → launch approval → operation → revenue evaluation. Each stage transition requires fresh evidence from an appropriate tool. A validation brief prepares an experiment; it never establishes customer demand. Static file checks cannot pass the runtime testing launch gate. Opportunities remain uncertain hypotheses and can be rejected early. Verified outcomes and failures update project priority; every fifth cycle considers exploration. Active projects are capped.

## Checks

```text
npm run typecheck
npm run lint
npm test
npm run build
```

**Windows:** stop the web/worker processes before `npm run build` or `db:generate`, because the loaded Prisma engine DLL cannot be replaced while in use.

The automated suite uses an isolated, temporary PostgreSQL engine, actual file writes and an HTTP model fixture. It covers emotions, net profit/loss and scaling, the 5:1 penalty, productive repetition, loop blocking, persistent memories after client restart, failed tools, approval interception, fabricated finance, append-only ledger, atomic budget reservation, job fencing/reclaiming, checkpoint replay, stages, rest/wake and dashboard data. Demo research remains labelled; tests never credit fake revenue to your development database.

With the local app running, test desktop/mobile rendering, settings, 3D loading and API boundaries:

```text
npx playwright install chromium
npm run test:e2e
```

Or use an installed Chrome in PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run test:e2e`. Screenshots are saved to `artifacts/`.

For a **limited real-provider research/build/static-verify smoke test**, configure real mode, stop the normal worker process, wait fifteen seconds, and run:

```text
npm run smoke:real
```

It makes at most three real model calls, uses the normal budget/supervisor/state machine, retrieves an approved source, creates `smoke.html`, statically checks it, and preserves the audit trail in a suspended smoke project. `SMOKE_RESEARCH_URL` optionally selects another exact approved public source. It stops on unexpected actions or inputs and never publishes. Missing credentials produce an explicit skip **before any call**. It does not establish that a model will make profitable decisions. Browser/runtime execution still needs Docker.

## Phone access and a server that runs without this PC

The current operator configuration also enables [independent work and public web access](docs/AUTONOMY.md), with no-key source discovery, source-link reading and deferred unavailable external steps.

The [free Ubuntu server setup](docs/HOSTING.md) preserves the current worker, supervisor, saved state and project files. `npm run deploy:prepare` creates a private transfer package and server SSH key. Account/VM access is required to complete deployment; preparing the package does not make Benwa publicly accessible.

## Standard PostgreSQL and Supabase

For local normal PostgreSQL:

```text
docker compose up -d postgres
```

Set `DATABASE_URL=postgresql://benwa:benwa-local-only@127.0.0.1:5432/benwa` in `.env`, migrate, seed, and start. Set a strong `POSTGRES_PASSWORD` for any non-disposable deployment.

Supabase uses the same relational schema and migrations. Use a private backend role and a direct or session-pooler URL. `DIRECT_URL`, when provided, is selected by `prisma.config.ts` for migrations; the application uses `DATABASE_URL`. RLS is enabled with no public policies. Do not expose credentials to browser code; disable the Data API for this private runtime database when unnecessary. No hosted Supabase project was created or changed during this build.

For production Node hosting:

```text
npm run db:migrate
npm run db:seed
npm run build
npm start
```

Run `npm run worker` and `npm run supervisor` under your process manager as separate services, using the same PostgreSQL URL and persistent workspace. Configure `DASHBOARD_PASSWORD`, a random `SESSION_SECRET` of at least 32 characters, HTTPS, request size limits and an authenticated reverse proxy before non-loopback access. This is a single-operator application. Local-only sessions are automatic; remote hosting without configured authentication fails closed. `.env` files and runtime data are ignored by source and container builds.

`Dockerfile` builds the dashboard and worker application. `docker compose --profile app run --rm web npm run db:migrate`, then the same command with `npm run db:seed`, then `docker compose --profile app up -d` starts the app stack. Set the password and session secret first. Named volumes preserve PostgreSQL and project files. **Containerised workers intentionally have no Docker daemon access, so sandbox actions are unavailable in this profile.** To enable local sandbox execution, run the trusted worker on the host/VM with Docker installed, against the same database and workspace; never mount the Docker host socket into app containers. Distributed sandbox execution requires a separately authenticated runner integration. Docker definitions were supplied but could not be executed on this host because Docker is not installed.

See [the architecture and recovery notes](docs/ARCHITECTURE.md). Source layout: `apps/web` (Astro, React, Tailwind, Three.js), `apps/worker` (background process), `packages/core` (agent, simulation, supervisor, ledger and tools), `prisma` (schema/migrations), and `sandbox` (isolated execution image).

## Verified here and remaining setup

Local disk-persisted PostgreSQL, migrations, worker restart, the full demo workflow, real source-file creation/read-back/static verification, persisted dashboard and supplied GLB rendering have been exercised. Tests use a deterministic fake provider and an actual HTTP tool-calling fixture. Type checking, lint, automated tests, responsive browser tests and the production build are included and run during implementation.

**Original build limitations:** live model research/build smoke, Docker execution/deployment, and payments were not verified during the initial build. The subsequent Gemini upgrade used the supplied key for bounded capability probes; see [the actual results](docs/GEMINI.md). Docker and payment integration are still unconfigured. No public website, marketing message, purchase, transfer or paid account was created. Benwa is experimentation infrastructure; profitable outcomes remain an experiment.
