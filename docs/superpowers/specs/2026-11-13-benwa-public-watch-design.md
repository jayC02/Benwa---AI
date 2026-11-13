# Watch Benwa: a public, read-only window into the house

Date: 2026-11-13
Status: draft, awaiting owner approval

## Intent

The dashboard's dollhouse view (see `2026-11-13-benwa-house-design.md`) was built to be a pet, a live window into the agent, and a showcase. Today only the owner can see it, because every page and API sits behind single-operator auth. The owner wants a link anyone can open to watch Benwa live: the 3D house, the "Right now" panel and a short feed of what he has been doing. It must be strictly read-only and must never expose money, approvals, settings or credentials.

## Goals

1. A public page, `/watch`, that a logged-out visitor can open. It shows:
   - the 3D house (`World`), including clicking a room to see what he did there
   - the "Right now" panel (`RightNow`)
   - a short activity feed of his last 10 actions
2. A public endpoint, `GET /api/watch`, that returns **only a whitelisted projection** of his state, built by its own queries. It must never call or reuse `snapshot()`.
3. Every free-text field passes through a scrubber before it leaves the server.
4. An owner-controlled on/off switch, **off by default**. When it is off, both `/watch` and `/api/watch` return 404.
5. The number of visitors never translates into database load. All visitors share one cached projection that is refreshed at most every 10 seconds.
6. A Playwright test proving the public endpoint never leaks finance, approvals, settings or credentials, plus unit tests for the scrubber and the projection.

## Non-goals

- No "Current project" panel, project list, milestones panel, ledger, approvals, assistance, supervisor, model monitoring or settings on the public page.
- No embedding in other sites. `X-Frame-Options: DENY` stays.
- No visitor accounts, comments, reactions, analytics or visitor counts.
- No change to the agent, worker, supervisor or ledger.
- No change to how the private dashboard behaves or looks.

## Anti-goals (failure even if it "works")

- **A leak.** Any amount of money, ledger entry, approval detail, assistance request text, setting, budget, model or provider config, API key, password, session cookie, email address, raw URL or internal database ID reaching a public visitor.
- **A control.** Any way for a public visitor to change anything: no mutating route reachable without the existing session and origin checks, and no session cookie minted for public visitors.
- **The public house lies.** It must show the same room and activity the private dashboard would show at that moment, apart from the coin dance (see the decided design).
- **Visitors can hurt Benwa.** Heavy traffic must not slow the worker or the database.

## Constraints and facts

- **Stack:** Astro 7 SSR (Node adapter), React 19 and Three.js. The private dashboard is `apps/web/src/pages/index.astro`, which renders `Dashboard` with `snapshot()` and polls `/api/state` every 4 seconds.
- **Auth:** `apps/web/src/middleware.ts` does the following.
  - It returns 503 for every request if `DASHBOARD_PASSWORD` is unset and the host isn't loopback.
  - It requires a valid `benwa_session` cookie except on `/login` and `/api/login`. On loopback with no password it mints a session on any GET.
  - It rejects non-GET/HEAD requests whose `Origin` doesn't match.
  - It sets `no-store`, `nosniff`, `DENY` and a sandbox CSP on `/api/*`.

  `/api/stripe` bypasses all of this.
- **Routes:** every operation lives in `apps/web/src/pages/api/[operation].ts`. A static file such as `pages/api/watch.ts` takes precedence over the dynamic route.
- **Hosting:** both deployment paths put a reverse proxy in front of the app, Caddy in `deploy/bootstrap-ubuntu.sh` and cloudflared in `scripts/phone.ts`. That means `clientAddress` is always the proxy (loopback), so per-IP limiting inside the app can't tell visitors apart.
- **What the house reads today:**
  - From `World.tsx` and `worldText.ts`:
    - `creature`: status, activity, thought, mood, energy
    - `workerOnline`
    - `cycle`: id, stage, createdAt
    - each action's id, cycleId, tool, status, intention and createdAt, plus its outcome's summary, verified, meaningful and simulated flags
    - milestone `{id, simulated}`
    - the count of pending approvals and the count of open assistance requests
    - `finance.net`, used only to trigger the "coin dance" when net rises
    - `roomHistory`
  - `RightNow.tsx` also reads the latest action's `rationale` and `creature.activity`.
- **Real text is revealing.** A live sample shows that thoughts, intentions, rationales and outcome summaries name the current business idea, quote fetched URLs and mention internal task IDs, for example "Task c<24-char cuid> requires…" and "Retrieved public source: https://<site>/…".
- **The owner's live worker is running** (`npm run dev`). Don't start or stop it. Don't run the "saves boundaries" e2e test while it runs. Run e2e with `PLAYWRIGHT_CHANNEL=msedge`.
- **Git:** the folder is a git repo on `main` with a **public** GitHub remote, and other sessions share this checkout. Commit or push only when the owner asks. Never commit `.env`, `.data/` or `artifacts/`, and never put real agent output (project names, IDs, fetched URLs) in committed tests or fixtures. Test fixtures use invented samples.

## Approaches considered

1. **Separate public projection plus a narrow `HouseView` type (chosen by the owner).** `publicWatch()` runs its own minimal queries that select only whitelisted columns. `World` and `RightNow` take a narrow `HouseView`, and the private dashboard adapts its full snapshot into one. Finance, approvals and settings are never loaded for the public route, so the whitelist is enforced by what the query selects.
2. **Pick safe fields out of the full `snapshot()`.** This is less code, but each public refresh loads the whole private state, and the public shape stays coupled to the private one. Rejected because it makes leaks easier.
3. **Reuse the full `Snapshot` shape with the sensitive parts blanked.** This hands out fake values in a dashboard-shaped object, and the house needs the real "waiting for you" counts. Rejected.

## Decided design

### Privacy boundary (owner decision: "everything, scrubbed")

Public visitors may see Benwa's own words, meaning thoughts, activity, intentions, rationales and outcome summaries, **after scrubbing**. This deliberately publishes the gist and the reasoning of his current business idea. The owner chose that for transparency.

**Whitelist.** This is the complete public payload. Nothing else may appear in it.

```ts
type PublicAction = {
  id: string;            // opaque: first 12 hex chars of sha256(action.id)
  cycleId: string;       // opaque, same hashing
  tool: string;          // e.g. "research.search" (tool names are not secret)
  status: string;        // PLANNED | SUCCEEDED | FAILED | AWAITING_APPROVAL | DEFERRED, anything else → "CLOSED" (see below)
  intention: string;     // scrubbed
  rationale: string;     // scrubbed
  createdAt: string;     // ISO
  outcome: { summary: string /* scrubbed */; verified: boolean; meaningful: boolean; simulated: boolean } | null;
};
type HouseView = {
  creature: { status: string; activity: string /* scrubbed */; thought: string /* scrubbed */; mood: number; energy: number };
  workerOnline: boolean;
  cycle: { id: string /* opaque */; stage: string; createdAt: string } | null;
  actions: PublicAction[];                       // latest 20
  milestones: { id: string /* opaque */; simulated: boolean }[];
  pendingApprovals: number;                      // count only
  openAssistance: number;                        // count only
  netMinor: string;                              // public: always "0" (see coin dance)
  roomHistory: Record<RoomId, PublicAction[]>;   // last 6 per room
};
type PublicWatch = HouseView & { serverTime: string };
```

The private dashboard's `houseView(snapshot)` adapter produces the same `HouseView` from the full snapshot, with real IDs, unscrubbed text and the real `finance.net`, so the private house behaves exactly as now.

**Never public**, enforced by the queries not selecting these:
- the action fields `input`, `target`, `strategy`, `expectedEvidence`, `costEstimateMinor`, `permissions`, `fingerprint`, `executions`, `projectId` and `goalId`
- projects, tasks and experiments
- memories
- interventions
- approval and assistance contents
- finance, budget and ledger
- agent configuration and settings
- model monitoring
- provider and search configuration
- heartbeat timestamps (only the derived `workerOnline` boolean is sent)
- curiosity, boredom, confidence and frustration (unused by the house)

**Scrubber** (`apps/web/src/server/scrub.ts`, a pure function). It applies these rules, in this order, to every free-text field:

| Pattern | Replaced with |
|---|---|
| URLs (`scheme://…`, `www.…`) | `[link]` |
| Email addresses | `[email]` |
| Money: a currency symbol or code (£ $ € GBP USD EUR pence) next to a number, in either order | `[amount]` |
| Windows or POSIX absolute paths (`C:\…`, `/home/…`, `/Users/…`, `/var/…`, `/etc/…`) | `[path]` |
| ID or credential-like tokens: 20+ characters of `[A-Za-z0-9_-]` mixing letters and digits (catches cuids, `AIza…`, `sk-…`), or 16+ hex characters | `[id]` |
| Runs of 9+ digits, allowing spaces and dashes (phone or account numbers) | `[number]` |

After those replacements, the scrubber collapses whitespace and caps each field at 400 characters, ending with `…`.

**Action statuses (my call).** The code also writes `REJECTED` and `APPROVED_PREPARATION` to actions. Publishing those would reveal how the owner decided on an approval. The public projection passes through only the five statuses above and sends every other status as `"CLOSED"`. Nothing in the house tests for those statuses: room selection checks `PLANNED`, `outcomeBadge` falls through to the outcome, and `actionStep` falls through to doing/done. So `"CLOSED"` renders exactly as the private view does, without saying which decision was made.

### Coin dance (builder's call, made here)

The coin dance plays when net profit rises. Detecting that publicly would mean loading finance, and it would reveal that money arrived. The public view sends `netMinor: "0"` constantly, so the coin dance never plays publicly. Milestone celebrations still play.

### Routes and middleware

- `apps/web/src/pages/watch.astro` server-renders with `await publicWatch()`. If the switch is off, it returns a plain 404 page. Otherwise it hydrates a new `PublicWatch` React component. The page has its own title and description ("Watch Benwa · live"). It has no links to the dashboard, no login link and no nav tabs.
- `apps/web/src/pages/api/watch.ts` exports `GET`. It returns `publicWatch()` as JSON, or 404 `{ error: "Not found" }` when the switch is off. No other methods are exported, so Astro answers 405 for the rest.
- `middleware.ts` gets a public branch placed **after** the 503 "not configured" check and **before** the session check:
  - If the path is exactly `/watch` or `/api/watch`, the method must be GET or HEAD, or the response is 405.
  - The request goes through the global rate limiter (below).
  - It never reads or mints `benwa_session`.
  - It calls `next()` and then applies the same security headers as other responses. On `/api/watch` it sets `Cache-Control: public, max-age=10`, so a proxy or CDN can absorb load. `/watch` keeps `no-store`.
- Every other path, and every non-GET method, goes through the existing logic unchanged.

### Cache and rate limit

- `publicWatch()` memoises one promise for 10 seconds, shared by all callers. Within that window, concurrent visitors share a single in-flight query. On a query error it serves the last good value for up to 60 seconds, then a 503.
- The switch is read inside the same cached refresh, so turning it off takes effect within 10 seconds. The owner's own toggle also clears the cache.
- Global limiter: a fixed window of 1,200 public requests per minute in total. Over that, the response is `429` with `Retry-After`. This is a flood guard only. Per-visitor limiting is left to the proxy, because the app sees only the proxy's address.
- The public page polls `/api/watch` every 10 seconds, or every 30 seconds while the tab is hidden, and backs off to 60 seconds after a 429 or 503.

### On/off switch

- Stored as a new `AgentConfiguration.publicWatch Boolean @default(false)` column, added by a new Prisma migration.
- Toggled by a new authenticated mutation, `POST /api/public-watch` `{ enabled: boolean }` (strict zod). It goes through the existing session and origin checks and records a verified episodic memory: "Owner turned public watching on/off".
- It's deliberately **not** part of the strict `Settings` schema, so the existing settings form and its tests are untouched.
- The Settings tab gets a small "Public watch page" panel. It has a checkbox, the public link (`<origin>/watch`) when on, and one line saying visitors see his thoughts and actions with links, IDs and amounts removed.

### Shared components

- New `apps/web/src/world/view.ts` holds `HouseView`, `PublicAction`, `houseView(snapshot)` and the opaque-ID helper.
- `World`, `RightNow` and `worldText.worldInput` change their prop type from `Snapshot` to `HouseView`:
  - `worldInput` reads `pendingApprovals` and `openAssistance` directly.
  - `reactionInput` reads `milestones` and `netMinor`.
- `Dashboard.tsx` passes `houseView(s)` to `World` and `RightNow`, memoised on `s`. The existing `house.spec.ts` tests, which mock `/api/state`, must keep passing unchanged.
- New `PublicWatch.tsx` lays out `World`, `RightNow` and `PublicFeed`.
- New `PublicFeed.tsx` lists the latest 10 actions. Each row shows the room chip, the outcome badge (`outcomeBadge`), the outcome summary or intention, and `ago(createdAt)`. It reuses existing CSS classes where possible.
- The page polls and keeps `houseRoom` in sync between `World` and `RightNow`, the same way `Dashboard` does.

### Tests

- **Unit (vitest)**
  - `scrub.test.ts` checks that each rule fires on invented, real-looking samples: a cuid-style task ID, a URL, `£12.50`, `1200 GBP`, `AIzaSy…`, `sk-…`, an email, `C:\Users\…`, a phone number. It also checks that ordinary sentences pass through unchanged.
  - A projection test checks that `toPublicWatch(rows)`, the pure mapping from the selected rows to `PublicWatch`, hashes IDs, scrubs every text field and outputs exactly the whitelisted keys.
- **Playwright** (`tests/browser/public-watch.spec.ts`)
  1. Save the current switch value through the authenticated request context and turn it on.
  2. Open a **fresh browser context with no cookies**.
  3. Check that `GET /api/watch` returns 200 and that the deep set of keys is a subset of the whitelist. The test fails on any denylisted key name, for example `finance`, `ledger`, `budget`, `approvals`, `assistance`, `configuration`, `settings`, `authorisedMinor`, `models`, `input`, `strategy`, `permissions`, `executions`, `memories`, `password`, `secret`, `token`, `apiKey`, `projectId`, `heartbeat`. It also fails if the serialised body matches `https?://`, an email pattern, a currency amount, or a raw cuid.
  4. Check that the response carries no `Set-Cookie`.
  5. Check that `/watch` renders the house image (`role=img` named "Benwa, your cream-coloured sprout creature…"), the "Right now" panel and the feed, with no buttons other than room labels and the animation pause or whole-house toggles.
  6. Check that a POST to `/api/watch` returns 405. Check that `POST /api/control` and `POST /api/public-watch` from the cookie-less public context are refused with 401 or 403. Today the middleware checks the session before the origin, so a visitor without a cookie gets 401. That order stays as it is.
  7. Turn the switch off and check that both routes return 404.
  8. Restore the saved value in `finally`.
- The existing "rejects cross-origin control requests…" test must still pass. Don't run "saves boundaries" while the worker is live.

## Left to the builder

- Exact CSS for the public layout: a single column on phones, with the house on top, then "Right now", then the feed.
- Copy for the off/404 page and the Settings panel line.
- Whether the denylist test walks keys recursively or compares against a generated key set. Either is fine, as long as nested objects are covered.
