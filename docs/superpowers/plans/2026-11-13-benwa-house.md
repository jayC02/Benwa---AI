# Benwa's House Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Benwa's static platform scene with a dollhouse-cutaway house. In it he walks between seven rooms based on his real activity and plays rough procedural animations, while the Home UI makes clear what he is doing now, why, what he's thinking, and what he has actually achieved.

**Architecture:** Pure, unit-tested logic modules live in `apps/web/src/world/`:
- room selection
- step and badge derivation
- reaction detection
- house layout and pathing
- the animation poses
- the director state machine
- camera framing

Thin Three.js modules (`rig.ts`, `house.ts`) turn that logic into meshes. A single React component, `World.tsx`, owns the renderer and replaces `Creature.tsx`. `snapshot.ts` gains read-only queries. `Dashboard.tsx` gets a re-ordered Home tab with new `RightNow` and `CurrentProject` panels.

**Tech Stack:** Astro 7, React 19, Three.js 0.180 (plain, no react-three-fiber), lucide-react, Prisma 6, Vitest 5, Playwright 1.56.

**Spec:** `docs/superpowers/specs/2026-11-13-benwa-house-design.md` (read it before starting any task)

## Global Constraints

- No new runtime dependencies. Use only what `apps/web/package.json` and the root `package.json` already have.
- No changes to the agent's runtime, tools, worker, supervisor, ledger or Prisma schema. `snapshot.ts` gets additive read-only queries only.
- The model file `apps/web/public/models/benwa.glb` is used unchanged. The model is Z-up with its face along +X, has 18 separate meshes, and has no skeleton or clips.
- Room IDs, exactly: `hall`, `study`, `workshop`, `library`, `planning`, `journal`, `bedroom`.
- Room display names, exactly: "Front hall", "Study", "Workshop", "Library", "Planning room", "Journal nook", "Bedroom".
- Simulated/demo outcomes never trigger the hop/dance reactions and are never shown as "Verified".
- Keep the current behaviour for:
  - reduced motion (`prefers-reduced-motion`)
  - pausing when hidden or offscreen
  - the WebGL failure fallback and the "Try the 3D view again" retry
  - GPU disposal on unmount
  - the pause-motion button, labelled "Pause creature animation" / "Resume creature animation"
- The 3D container keeps `role="img"` and an `aria-label` starting "Benwa, your cream-coloured sprout creature". An existing Playwright test matches this.
- Copy tone matches the existing UI: gentle and lower-case-friendly ("A day in his life", "His little nest egg").
- The project directory is **not a git repository**. Each task's "Checkpoint" step means: run the listed checks and stop if any fail. Commit only if the user has initialised git by then.
- Test commands: `npx vitest run <file>` for unit tests; `npm run typecheck`; `npm run lint`; `npm run test:e2e` (needs `npm run dev` running on 127.0.0.1:4321).

## Review Focus

1. **The snapshot arrives with a brand-new action from a different project mid-walk.** Benwa should re-route from where he stands, not teleport and not finish the old walk first. Covered in the Task 6 test `retargets mid-walk from current position`.
2. **First page load.** No hop/dance/slump should fire for history that already existed before the page opened. Covered in the Task 3 test `first snapshot triggers nothing`.
3. **The worker is offline but the stored status still says RUNNING (stale DB state).** He must not look busy. Covered in the Task 1 test `offline worker sleeps even if status says RUNNING`.
4. **A project with zero milestones, tasks or actions** (just created), or no active project at all. The panels should show a gentle empty state, not crash or render blank. Covered in the Task 2 test `empty project track` and the Task 9 Playwright case `fresh install`.
5. **Narrow phone viewport (375px).** The house must still be readable, which means zooming to his current room, and the labels must not overflow. Covered in the Task 8 test `narrow aspect frames current room` and the Task 9 mobile screenshot check.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/world/rooms.ts` (create) | Room IDs and metadata, tool→room map, `selectScene` precedence rules. Pure. |
| `apps/web/src/world/progress.ts` (create) | `actionStep`, `outcomeBadge`, `stageTrack`. Pure. |
| `apps/web/src/world/reactions.ts` (create) | `detectReactions` between two snapshots. Pure. |
| `apps/web/src/world/layout.ts` (create) | House dimensions, room extents, work spots, stair tower, `planPath`. Pure. |
| `apps/web/src/world/animations.ts` (create) | `Pose`, `AnimName`, `poseAt`, `animForTarget`, one-shot durations. Pure. |
| `apps/web/src/world/director.ts` (create) | State machine: target → path → walking → room loop, plus the reaction queue. Pure. |
| `apps/web/src/world/camera.ts` (create) | `cameraFrame` for whole-house and room zoom modes. Pure. |
| `apps/web/src/world/rig.ts` (create) | Re-pivots the GLB meshes and applies a `Pose`. Three.js. |
| `apps/web/src/world/house.ts` (create) | Builds the low-poly house meshes from `layout.ts`. Three.js. |
| `apps/web/src/components/World.tsx` (create) | Renderer lifecycle, frame loop, thought bubble, room labels, zoom panel, fallbacks. |
| `apps/web/src/components/RightNow.tsx` (create) | The "Right now" panel. |
| `apps/web/src/components/CurrentProject.tsx` (create) | Project card: stage track, task checklist, "What he's actually done". |
| `apps/web/src/components/Creature.tsx` (delete) | Replaced by `World.tsx`. |
| `apps/web/src/components/Dashboard.tsx` (modify) | Home tab re-order and feed badges, around lines 501–636. |
| `apps/web/src/server/snapshot.ts` (modify) | Adds `cycle`, `projectHistory`, `roomHistory`, and milestone `simulated`. |
| `apps/web/src/styles/global.css` (modify) | Styles for the house hero, bubble, labels, panels and badges. Remove dead `.habitat*` / `.room-*` rules. |
| `docs/ARCHITECTURE.md` (modify) | Replace the last paragraph about the model viewer. |
| `tests/world-*.test.ts` (create) | Unit tests per pure module, plus the rig and house tests. |
| `tests/integration.test.ts` (modify) | Snapshot additions test. |
| `tests/browser/dashboard.spec.ts` (modify) | House, panels, mobile. |

---

### Task 1: Room metadata and scene selection

**Files:**
- Create: `apps/web/src/world/rooms.ts`
- Test: `tests/world-rooms.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RoomId = "hall"|"study"|"workshop"|"library"|"planning"|"journal"|"bedroom";
  export type Activity = "work"|"ponder"|"sleep"|"sit"|"wait"|"confused";
  export const ROOM_IDS: readonly RoomId[];
  export const ROOMS: Record<RoomId, { name: string; floor: 0|1|2; tools: readonly string[]; colour: string }>;
  export function roomForTool(tool: string): RoomId | null;
  export interface WorldInput {
    status: string; workerOnline: boolean;
    cycle: { id: string; stage: string } | null;
    latestAction: { cycleId: string; tool: string; status: string } | null;
    pendingApprovals: number; openAssistance: number;
    previousRoom: RoomId | null;
  }
  export interface WorldTarget { room: RoomId; activity: Activity; label: string | null }
  export function selectScene(input: WorldInput): WorldTarget;
  ```
- Tool map:
  - `hall`: `external.request`
  - `study`: `workspace.write`, `workspace.read`, `workspace.inspect`
  - `workshop`: `sandbox.run`, `browser.test`
  - `library`: `research.search`, `research.fetch`
  - `planning`: `project.plan`, `project.advance`, `project.reject`
  - `journal`: `memory.learn`
  - `bedroom`: `rest`
- Floors: hall, study and workshop are on floor 0; library, planning and journal are on floor 1; bedroom is on floor 2.

- [ ] **Step 1: Write the failing tests** in `tests/world-rooms.test.ts`. Use a helper `base(): WorldInput` with RUNNING, worker online, `cycle {id:"c1", stage:"EXECUTING"}`, latest action `{cycleId:"c1", tool:"research.fetch", status:"PLANNED"}`, zero approvals and assistance, and `previousRoom: null`.
  - `maps every tool to its room`: `roomForTool("research.search")==="library"`, … for all 13 tools; `roomForTool("nope")===null`.
  - `offline worker sleeps even if status says RUNNING`: `{...base(), workerOnline:false}` → `{room:"bedroom", activity:"sleep", label:"Worker offline"}`.
  - `review/error stays put and is confused`: status `REVIEW_REQUIRED`, `previousRoom:"study"` → `{room:"study", activity:"confused"}`; with `previousRoom:null` → room `bedroom`.
  - `waiting for you goes to the hall`: each of status `WAITING_APPROVAL`, status `WAITING_ASSISTANCE`, `pendingApprovals:1` with status `PAUSED`, and `openAssistance:1` with status `RUNNING` → `{room:"hall", activity:"wait"}`.
  - `paused states go to bed`: `RESTING` → `sleep`; `PAUSED`, `BUDGET_PAUSED`, `QUOTA_PAUSED` → `{room:"bedroom", activity:"sit"}`.
  - `executing action picks its room`: base → `{room:"library", activity:"work"}`; the same holds with stage `VALIDATING` and with stage `VERIFYING`.
  - `finished or deciding ponders in last action's room`:
    - stage `DECIDING` with the action from cycle `c0` → `{room:"library", activity:"ponder"}`
    - stage `EXECUTING` with action status `SUCCEEDED` → `ponder`
  - `deferred external request only counts while executing`: tool `external.request`, status `DEFERRED`, stage `DONE` → `{room:"hall", activity:"ponder"}`.
  - `no actions ever sleeps in bedroom`: `latestAction:null`, cycle null, RUNNING → `{room:"bedroom", activity:"sit"}`.
  - `rest tool sleeps`: tool `rest`, executing → `{room:"bedroom", activity:"sleep"}`.

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/world-rooms.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rooms.ts`.** Apply the spec's rules 1→7 in order, with first match winning. "Executing" means `cycle.stage ∈ {VALIDATING, EXECUTING, VERIFYING}` AND `latestAction.cycleId === cycle.id` AND `latestAction.status === "PLANNED"`. A bedroom target with `work` activity becomes `sleep`. The label is `null` except "Worker offline". Colours are free (soft pastels).

- [ ] **Step 4: Run the tests to verify they pass.** Run `npx vitest run tests/world-rooms.test.ts`. Expected: PASS.

- [ ] **Step 5: Checkpoint.** Run `npm run lint` and expect it to be clean.

---

### Task 2: Progress derivations (step, badge, stage track)

**Files:**
- Create: `apps/web/src/world/progress.ts`
- Test: `tests/world-progress.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  export type Step = "idle"|"deciding"|"doing"|"checking"|"done"|"failed"|"waiting"|"deferred";
  export function actionStep(
    cycle: { id: string; stage: string } | null,
    action: { cycleId: string; status: string } | null,
  ): Step;
  export type Badge = "verified"|"demo"|"failed"|"waiting"|"deferred"|"nothing-new"|"in-progress";
  export const BADGE_LABEL: Record<Badge, string>;
  // "Verified", "Demo", "Failed", "Waiting for you", "Deferred", "Done, nothing new", "In progress"
  export function outcomeBadge(action: {
    status: string;
    outcome: { verified: boolean; meaningful: boolean; simulated: boolean } | null;
  }): Badge;
  export const STAGES: readonly string[]; // the 9 stages in order, copied from packages/core/src/schema.ts
  export type StageState = "done"|"demo"|"current"|"todo";
  export function stageTrack(project: {
    stage: string;
    milestones: { stage: string; simulated: boolean }[];
  }): { stage: string; label: string; state: StageState }[];
  ```

- [ ] **Step 1: Write the failing tests.**
  - `actionStep`:
    - `(null, null)` → `idle`
    - cycle `DECIDING` and the action from another cycle → `deciding`
    - cycle `DECIDING` with no action → `deciding`
    - same cycle, `EXECUTING` / `PLANNED` → `doing`
    - `VALIDATING` / `PLANNED` → `doing`
    - `VERIFYING` / `PLANNED` → `checking`
    - status `SUCCEEDED` → `done`
    - status `FAILED` → `failed`
    - status `AWAITING_APPROVAL` → `waiting`
    - status `DEFERRED` → `deferred`
    - stage `WAITING_ASSISTANCE` → `waiting`
  - `outcomeBadge`:
    - SUCCEEDED with an outcome that is verified, meaningful and not simulated → `verified`
    - an outcome with `simulated:true` → `demo`, even when meaningful
    - SUCCEEDED but not meaningful → `nothing-new`
    - FAILED → `failed`
    - PLANNED with no outcome → `in-progress`
  - `stageTrack`:
    - `empty project track`: stage `DISCOVERY` with no milestones → 9 entries, the first `current` and the rest `todo`
    - stage `BUILDING` with milestones `DISCOVERY` (real), `RESEARCH` (simulated), `VALIDATION` (real) and `PLANNING` (real):
      - states are `done`, `demo`, `done`, `done`, `current`, `todo`, `todo`, `todo`, `todo`
      - the labels are title-cased with spaces, e.g. `"Launch approval"` and `"Revenue evaluation"`

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run tests/world-progress.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `progress.ts`.** A milestone's stage is the stage that was *completed*, as `project.advance` in `packages/core/src/tools.ts` records it. Status checks take priority over the cycle stage, except for `deciding`, which applies when the action does not belong to the current cycle.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Checkpoint.** Run `npm run lint`.

---

### Task 3: Reaction detection

**Files:**
- Create: `apps/web/src/world/reactions.ts`
- Test: `tests/world-reactions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Reaction = "hop"|"slump"|"dance"|"bigDance";
  export interface ReactionInput {
    actions: {
      id: string;
      status: string;
      outcome: { verified: boolean; meaningful: boolean; simulated: boolean } | null;
    }[];
    milestones: { id: string; simulated: boolean }[];
    netMinor: string; // decimal string, e.g. snapshot.finance.net
  }
  export function detectReactions(prev: ReactionInput | null, next: ReactionInput): Reaction[];
  ```

- [ ] **Step 1: Write the failing tests.**
  - `first snapshot triggers nothing`: `detectReactions(null, anything)` → `[]`.
  - `verified success hops`: an action that is new, or that changed from PLANNED to SUCCEEDED with a verified, meaningful, non-simulated outcome → `["hop"]`.
  - `simulated success does not hop`: the same with `simulated:true` → `[]`.
  - `failure slumps`: an action that is new or became FAILED → `["slump"]`.
  - `unchanged action does nothing`: the same action and status in both snapshots → `[]`.
  - `real milestone dances, demo milestone does not`: a new milestone id with `simulated:false` → includes `"dance"`; with `simulated:true` → does not.
  - `profit increase triggers bigDance`: `netMinor` going from `"0"` to `"1500"` → includes `"bigDance"`; going from `"1500"` to `"900"` → does not.
  - `order and cap`: one slump, one hop, a milestone and a profit increase together → `["slump","hop","dance","bigDance"]` truncated to the first 3 → `["slump","hop","dance"]`.
    - Rationale: cap at 3 so a burst never queues a long show. Order is fails, then successes, then milestones, then money; within each kind, at most one entry per kind.

- [ ] **Step 2: Run the tests to verify they fail.**

- [ ] **Step 3: Implement `reactions.ts`.** Compare `netMinor` with `BigInt`.

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Checkpoint.** Run `npm run lint`.

---

### Task 4: Snapshot additions

**Files:**
- Modify: `apps/web/src/server/snapshot.ts`
- Test: `tests/integration.test.ts` (add one `it` inside the existing `describe("Persisted execution, finance and supervision")`)

**Interfaces:**
- Consumes: `ROOMS`, `ROOM_IDS`, and `RoomId` from Task 1 (import from `../world/rooms`).
- Produces new `Snapshot` fields (wire types follow the existing `Wire<>` conversion):
  ```ts
  cycle: { id: string; stage: string; createdAt: string; completedAt: string | null } | null; // latest AgentCycle by createdAt
  projectHistory: Record<string /* projectId */, HistoryItem[]>; // ACTIVE projects only, newest 8 each
  roomHistory: Record<RoomId, HistoryItem[]>;                     // newest 6 actions whose tool is in that room's tools
  // HistoryItem = { id, cycleId, projectId, tool, intention, status, createdAt,
  //                 outcome: { summary, verified, meaningful, simulated } | null }
  // projects[].milestones[] gains: simulated: boolean  (evidence action outcome?.simulated ?? false)
  ```

- [ ] **Step 1: Write the failing test** `it("snapshot exposes current cycle, per-project and per-room history, and demo milestones")`:
  1. Run one demo cycle the way the neighbouring tests do (use the same helpers that file already uses to run a cycle).
  2. Call `(await import("../apps/web/src/server/snapshot")).snapshot()`.
  3. Assert:
     - `s.cycle?.id` equals the latest `db.agentCycle` id
     - `s.projectHistory[project.id].length >= 1`
     - `s.projectHistory[project.id].length <= 8`
     - every `s.roomHistory.library` item's tool starts with `research.`
     - `Object.keys(s.roomHistory).sort()` equals the sorted 7 room IDs
     - every `s.projects[n].milestones[m]` has a boolean `simulated`
  4. If importing `snapshot.ts` under Vitest fails to resolve `@benwa/core`, add `resolve.alias` to `vitest.config.ts`: `{"@benwa/core": path.resolve("packages/core/src/index.ts")}`.

- [ ] **Step 2: Run the test to verify it fails.** Run `npx vitest run tests/integration.test.ts -t "snapshot exposes"`. Expected: FAIL (`cycle` is undefined).

- [ ] **Step 3: Implement the queries in `snapshot.ts`.**
  - Add them to the existing `Promise.all`.
  - `roomHistory` is 7 `findMany({ where: { tool: { in: ROOMS[id].tools } }, take: 6, orderBy: createdAt desc, select: … })` calls.
  - `projectHistory` uses one query per ACTIVE project (at most `maxProjects`, default 3).
  - Change the `projects` include to `milestones: { include: { evidenceAction: { select: { outcome: { select: { simulated: true } } } } } }` and map it to a flat `simulated` boolean before returning. Do not leak `evidenceAction` to the client.

- [ ] **Step 4: Run the test to verify it passes.** Then run the whole integration file: `npx vitest run tests/integration.test.ts`. Expected: all PASS.

- [ ] **Step 5: Checkpoint.** Run `npm run typecheck`. `Dashboard.tsx` must still compile.

---

### Task 5: House layout and path planning

**Files:**
- Create: `apps/web/src/world/layout.ts`
- Test: `tests/world-layout.test.ts`

**Interfaces:**
- Consumes: `RoomId` and `ROOMS` from Task 1.
- Produces:
  ```ts
  export const FLOOR_HEIGHT = 3;        // world units; floor n's floor surface is at y = n * FLOOR_HEIGHT
  export const HOUSE_DEPTH = 4;         // z from -2 (back wall) to +2 (open front)
  export const STAIR_X = 8.25;          // stair tower spans x 7.5..9 on all floors
  export const WALK_SPEED = 3.5;        // units per second
  export const CLIMB_SECONDS = 1.2;     // per floor
  export const ROOM_EXTENTS: Record<RoomId, { floor: 0|1|2; minX: number; maxX: number }>;
  // hall -7.5..-2.5, study -2.5..2.5, workshop 2.5..7.5 (floor 0)
  // library -7.5..-2.5, planning -2.5..2.5, journal 2.5..7.5 (floor 1)
  // bedroom -2.5..7.5 (floor 2, attic)
  export const WORK_SPOT: Record<RoomId, { x: number; z: number }>; // x inside room extent, z = 0.6
  export interface Waypoint { floor: number; x: number; mode: "walk"|"climb" }
  export function planPath(from: { floor: number; x: number }, to: RoomId): Waypoint[];
  export function pathSeconds(from: { floor: number; x: number }, path: Waypoint[]): number;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `work spots sit inside their rooms`: for each room, `minX < WORK_SPOT.x < maxX`.
  - `same floor walks directly`: from `{floor:0,x:-5}` to `study` → `[{floor:0,x:WORK_SPOT.study.x,mode:"walk"}]`.
  - `different floor goes via stairs`: from `{floor:0,x:-5}` to `library` → `[{0,STAIR_X,walk},{1,STAIR_X,climb},{1,WORK_SPOT.library.x,walk}]`.
  - `attic climbs two floors one at a time`: hall → bedroom gives two climb waypoints, for floor 1 and then floor 2.
  - `already there is empty`: from the study's work spot to `study` → `[]`.
  - `longest trip is under 8 seconds`: `pathSeconds({0, WORK_SPOT.hall.x}, planPath(..., "bedroom")) < 8`.

- [ ] **Step 2: Run the tests to verify they fail.**

- [ ] **Step 3: Implement `layout.ts`.** It is pure data plus the two functions. No Three.js import.

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Checkpoint.** Run `npm run lint`.

---

### Task 6: Animation poses and director state machine

**Files:**
- Create: `apps/web/src/world/animations.ts`, `apps/web/src/world/director.ts`
- Test: `tests/world-animations.test.ts`, `tests/world-director.test.ts`

**Interfaces:**
- Consumes: `WorldTarget` and `RoomId` (Task 1); `Reaction` (Task 3); `planPath`, `Waypoint`, `WORK_SPOT`, `WALK_SPEED`, `CLIMB_SECONDS` and `FLOOR_HEIGHT` (Task 5).
- Produces (`animations.ts`):
  ```ts
  export type AnimName = "idle"|"walk"|"climb"|"type"|"read"|"tinker"|"pin"|"write"|"post"|"wait"
    |"sleep"|"sit"|"ponder"|"confused"|"hop"|"slump"|"dance"|"bigDance";
  export interface Pose {           // all angles in radians, 0 = rest pose
    legL: number; legR: number;     // swing forward(+)/back(-) about hip
    armL: number; armR: number;     // swing forward(+)/back(-) about shoulder
    armLRaise: number; armRRaise: number; // lift outward about shoulder
    bob: number;                    // body y offset in Benwa-heights (0..0.15)
    lean: number; tilt: number;     // pitch forward(+), roll sideways
    squash: number;                 // -0.1..0.1, y scale = 1+squash, xz = 1-squash/2
    eyeOpen: number;                // 0 closed .. 1 open
    leafSway: number;
    turn: number;                   // extra yaw on top of facing
    prop: "none"|"book"|"letter"|"pencil"|"note"|"question"|"zzz"|"smoke"|"coins"; // overlay hint for World
  }
  export const ONE_SHOT_SECONDS: Record<"hop"|"slump"|"dance"|"bigDance", number>; // 1.2, 2.5, 3, 5
  export function poseAt(anim: AnimName, t: number): Pose;
  export function animForTarget(target: WorldTarget): AnimName;
  // work: hall→post, study→type, workshop→tinker, library→read, planning→pin, journal→write, bedroom→sleep
  // ponder→ponder, sleep→sleep, sit→sit, wait→wait, confused→confused
  ```
- Produces (`director.ts`):
  ```ts
  export interface DirectorState {
    floor: number; x: number; y: number;   // y animates during climbs
    facing: number;                         // radians; 0 = facing camera (+Z), ±PI/2 = walking ±X
    target: WorldTarget; path: Waypoint[];
    queue: Reaction[]; oneShot: { anim: AnimName; started: number } | null;
    loopStarted: number;
  }
  export function createDirector(target: WorldTarget, now: number): DirectorState; // placed at target's work spot
  export function setTarget(s: DirectorState, target: WorldTarget, now: number): DirectorState;
  export function enqueue(s: DirectorState, reactions: Reaction[]): DirectorState;
  export function tick(s: DirectorState, dt: number, now: number):
    { state: DirectorState; anim: AnimName; animTime: number };
  export function currentRoom(s: DirectorState): RoomId | null; // room whose extent contains x on floor
  ```

- [ ] **Step 1: Write the failing tests.**
  - `world-animations.test.ts`:
    - `walk legs alternate`: for t in 0..2 step 0.1, `poseAt("walk",t).legL ≈ -poseAt("walk",t).legR` (within 1e-6) and `max |legL| > 0.3`.
    - `sleep has closed eyes`: `poseAt("sleep", t).eyeOpen <= 0.15` for sampled t, and `prop === "zzz"`.
    - `idle blinks briefly`: over t ∈ [0,7) at 0.02 steps, at least one sample has `eyeOpen < 0.3` and at least 90% have `eyeOpen === 1`.
    - `every pose is finite`: every AnimName at t ∈ {0, 0.5, 3.3, 100} has all numeric fields finite.
    - `animForTarget table`: the 7 work mappings plus the 5 non-work activities.
    - `one-shots carry props`: `slump` → `smoke` at some t, `bigDance` → `coins`, `confused` → `question`.
  - `world-director.test.ts` (place targets with `{room, activity:"work", label:null}`):
    - `starts at work spot playing room loop`: `createDirector(library)`, then tick → anim `read`, with x = `WORK_SPOT.library.x` and floor 1.
    - `walks then climbs then works`: from study to library. Ticking 0.1s repeatedly yields `walk` and then `climb`, ending with `read`. Total time < 8s; `facing` is ±π/2 while walking and 0 at the end.
    - `retargets mid-walk from current position`: from hall toward workshop. Tick 1s, record x; then `setTarget(study)`. The next waypoints come from `planPath({floor:0,x}, "study")` and x never jumps more than `WALK_SPEED*dt` per tick.
    - `reactions wait until arrival`: `enqueue(["hop"])` while walking. Anim stays `walk` until arrival, then `hop` plays for `ONE_SHOT_SECONDS.hop` and returns to the loop.
    - `reactions play in sequence`: `enqueue(["slump","hop"])` while working → `slump` (2.5s) then `hop` (1.2s), then the loop.
    - `same target does not restart`: `setTarget` with an equal target leaves `path` empty and `loopStarted` unchanged.

- [ ] **Step 2: Run the tests to verify they fail.**

- [ ] **Step 3: Implement `animations.ts`.** Use sin/cos curves, with stepped or jerky motion welcome. Blink: eyes close for 0.15s every ~6.4s, as the old `Creature.tsx` did.

- [ ] **Step 4: Implement `director.ts`.** It is immutable (returns new objects). During a climb, `y` interpolates between floors over `CLIMB_SECONDS` and x stays at `STAIR_X`.

- [ ] **Step 5: Run the tests to verify they pass.**

- [ ] **Step 6: Checkpoint.** Run `npm run lint`.

---

### Task 7: Benwa rig (re-pivoted model) and the invisible-model bug

**Files:**
- Create: `apps/web/src/world/rig.ts`
- Test: `tests/world-rig.test.ts`

**Interfaces:**
- Consumes: `Pose` from Task 6.
- Produces:
  ```ts
  export const BENWA_HEIGHT = 1.5;  // world units, feet at y=0
  export interface BenwaRig {
    object: THREE.Group;            // Y-up, feet at y=0, centred on x/z, faces +Z at yaw 0
    apply(pose: Pose): void;
    headTop(): THREE.Vector3;       // world-space point just above the leaves (for the thought bubble)
    dispose(): void;
  }
  export function createRig(gltfScene: THREE.Group): BenwaRig;
  export async function loadRig(url: string, signal: AbortSignal): Promise<BenwaRig>; // fetch + GLTFLoader.parseAsync + createRig
  ```
- Joint pivots, in source model coordinates (Z-up, face +X); taken from the GLB bounds:
  - hips: `(-0.185, ±0.31, 0.646)`. Each foot moves with its leg.
  - shoulders: `(-0.24, ±0.56, 1.50)`. Each hand moves with its arm.
  - leaf cluster: `(0.395, 0, 2.66)`, covering the stem, both leaf stems and both leaves.
  - eyes: each eyeball and pupil centred on its own bounds, as the old code did.
  - "Left" meshes have negative source Y.

- [ ] **Step 1: Diagnose the invisible model first.** Use the superpowers:systematic-debugging skill.
  - In `artifacts/desktop.png` the scene controls are visible, so the old `Creature.tsx` reached `load === "ready"`, yet no creature is drawn.
  - Start `npm run dev` and open `/` in the browser pane.
  - In the console, inspect the root group's world bounding box against the camera frustum.
  - Write the root cause in one line at the top of `rig.ts` as a comment, and make sure the rig's normalisation cannot reproduce it.

- [ ] **Step 2: Write the failing tests.** Parse `apps/web/public/models/benwa.glb` with `new GLTFLoader().parseAsync(buffer.buffer, "")` in Node.
  - `normalises size and orientation`: the bounding box of `rig.object` has height within `BENWA_HEIGHT ± 0.03` and `min.y ≈ 0` (±0.01). The pupils' world-space centre has z > the body centre z, meaning the face points toward +Z.
  - `has every limb pivot`: groups named `pivot:legL`, `pivot:legR`, `pivot:armL`, `pivot:armR`, `pivot:leaves`, `pivot:eyeL`, `pivot:eyeR` exist.
  - `left leg swing moves only the left foot`: `apply({...rest, legL:0.6})` changes the left foot mesh's world position by more than 0.02 and the right foot's by less than 1e-6.
  - `closing eyes scales eyes`: with `eyeOpen:0.1`, the eye pivot's vertical scale is ≤ 0.15.
  - `headTop is above the model`: `headTop().y > BENWA_HEIGHT * 0.95`.

- [ ] **Step 3: Run the tests to verify they fail.**

- [ ] **Step 4: Implement `rig.ts`.**
  - Wrap the source in a group rotated `-PI/2` about X (Z-up → Y-up) and yawed so +X faces +Z.
  - Scale to `BENWA_HEIGHT`.
  - Re-parent each limb mesh under a pivot `Group` positioned at its joint. Translate the mesh geometry by the negative joint position, so the rest pose is unchanged.
  - `apply` sets the pivot rotations, body bob/lean/tilt/squash, the eye vertical scale (`max(0.1, eyeOpen)`) and the leaf sway.
  - Body-level transforms go on an inner group, so the director's position and yaw on `object` stay independent.

- [ ] **Step 5: Run the tests to verify they pass.**

- [ ] **Step 6: Checkpoint.** Run `npm run lint`, then `npm run typecheck`.

---

### Task 8: House meshes and camera framing

**Files:**
- Create: `apps/web/src/world/house.ts`, `apps/web/src/world/camera.ts`
- Test: `tests/world-house.test.ts`, `tests/world-camera.test.ts`

**Interfaces:**
- Consumes: `ROOM_EXTENTS`, `HOUSE_DEPTH`, `FLOOR_HEIGHT`, `STAIR_X` and `WORK_SPOT` (Task 5); `ROOMS` and `RoomId` (Task 1).
- Produces (`house.ts`):
  ```ts
  export interface House {
    group: THREE.Group;
    labelAnchor: Record<RoomId, THREE.Vector3>; // top-centre of each room, just under the ceiling, z = HOUSE_DEPTH/2
    setRoomHighlight(room: RoomId | null): void; // subtle emissive tint on that room's floor
    dispose(): void;
  }
  export function buildHouse(): House;
  ```
- Produces (`camera.ts`):
  ```ts
  export type CameraMode = { kind: "house" } | { kind: "room"; room: RoomId };
  export interface Frame { centre: { x: number; y: number }; viewHeight: number } // orthographic, world units
  export function cameraFrame(mode: CameraMode, aspect: number, benwa: { x: number; y: number }): Frame;
  export function defaultMode(aspect: number, benwaRoom: RoomId): CameraMode; // aspect < 0.9 → room mode
  export const HOUSE_BOUNDS: { minX: number; maxX: number; minY: number; maxY: number }; // includes roof and stair tower
  ```

- [ ] **Step 1: Write the failing tests.**
  - `world-house.test.ts`:
    - `every room has a group with props`: `group.getObjectByName("room:"+id)` exists for all 7 rooms and holds at least 3 meshes.
    - `front is open`: no mesh's world bounding box has `min.z > HOUSE_DEPTH/2 - 0.05` and a width > 2, meaning there is no front wall.
    - `stair tower spans every floor`: the object `stairs` has a world bounding box with `min.y <= 0` and `max.y >= 2*FLOOR_HEIGHT`.
    - `dispose frees geometry`: after `dispose()`, a spy on `BufferGeometry.prototype.dispose` has been called at least as many times as there are meshes.
  - `world-camera.test.ts`:
    - `house frame contains whole house`: for aspects 16/9, 4/3 and 1, `HOUSE_BOUNDS` fits inside the frame (half-width = viewHeight*aspect/2), with Benwa at any position inside the house.
    - `room frame contains the room`: for each room at aspect 16/9 and 0.46, the room's extent and its floor-to-ceiling height fit.
    - `narrow aspect frames current room`: `defaultMode(0.46, "library")` → `{kind:"room", room:"library"}`; `defaultMode(1.6, "library")` → `{kind:"house"}`.
    - `house frame follows Benwa a little`: the centre x moves toward Benwa's x by 15–35% of the offset, clamped so the house still fits.

- [ ] **Step 2: Run the tests to verify they fail.**

- [ ] **Step 3: Implement `house.ts`.**
  - Use flat-shaded `MeshStandardMaterial` (`flatShading: true`) boxes, cylinders and cones.
  - Build back walls, floors/ceilings, side walls, a triangular attic roof and a stair tower with steps.
  - Each room gets the spec's props in rough form and a sign plane.
  - Name each room group `room:<id>` and the tower `stairs`.
  - Meshes cast and receive shadows.
  - Reuse geometries and materials per colour so `dispose` is cheap.

- [ ] **Step 4: Implement `camera.ts`.** It is pure maths with no Three.js import.

- [ ] **Step 5: Run the tests to verify they pass.**

- [ ] **Step 6: Checkpoint.** Run `npm run lint`.

---

### Task 9: `World.tsx`, which replaces `Creature.tsx`

**Files:**
- Create: `apps/web/src/components/World.tsx`
- Delete: `apps/web/src/components/Creature.tsx`
- Modify: `apps/web/src/components/Dashboard.tsx` (swap `<Creature …/>` for `<World s={s} />` and remove the old `.thought` block under it); `apps/web/src/styles/global.css`
- Test: `tests/browser/dashboard.spec.ts`

**Interfaces:**
- Consumes:
  - `selectScene` and `ROOMS` (Task 1)
  - `detectReactions` (Task 3)
  - `snapshot.cycle` and `roomHistory` (Task 4)
  - `createDirector`, `setTarget`, `enqueue`, `tick` and `currentRoom` (Task 6)
  - `poseAt` and `animForTarget` (Task 6)
  - `loadRig` (Task 7)
  - `buildHouse`, `cameraFrame` and `defaultMode` (Task 8)
- Produces: `export default function World({ s }: { s: Snapshot })`. The DOM contract the browser tests rely on:
  - the container has `role="img"` and `aria-label` = `Benwa, your cream-coloured sprout creature, in the ${ROOMS[room].name.toLowerCase()}, ${activityWords}. Mood N. Energy N.`
  - `data-model-state` is `"loading"`, `"ready"` or `"error"`
  - `data-room` and `data-activity` are always set from `selectScene`, even before the model loads
  - room labels are `<button>`s named `Look in the ${name}`
  - a "Whole house" button appears while zoomed
  - the zoom panel is a region labelled `What he's done in the ${name}`; it lists `roomHistory[room]` with `BADGE_LABEL` badges and an empty state "Nothing here yet."
  - the thought bubble element has `data-testid="thought-bubble"` and shows `s.creature.thought` (CSS clamps it to 2 lines; the `title` holds the full text). It shows "z z z" while sleeping and "…" while pondering.

- [ ] **Step 1: Write the failing Playwright tests** in `tests/browser/dashboard.spec.ts`, routing `/api/state` with a modified real snapshot as the existing test does:
  - `house shows Benwa in the room matching his action`:
    - Set status RUNNING, `workerOnline:true`, `cycle {id:X, stage:"EXECUTING"}` and `actions[0] = {...actions[0], cycleId:X, tool:"research.fetch", status:"PLANNED"}`.
    - Expect the `img` to have `data-room="library"`, `data-activity="work"` and an aria-label containing "in the library".
    - Wait for `data-model-state="ready"`.
  - `thought bubble shows his thought`: set `creature.thought = "Maybe a tiny invoice tool?"` → the bubble has that text.
  - `clicking a room zooms and lists what he did there`: click `Look in the Study` → the "What he's done in the Study" region is visible, then the "Whole house" button returns the view.
  - `offline worker shows sleeping`: `workerOnline:false` → `data-room="bedroom"`, `data-activity="sleep"`, and the text "Worker offline" is visible.
  - `fresh install`: `actions:[]`, `projects:[]`, `cycle:null` → `data-room="bedroom"`, no console errors.
  - Update the existing test: keep its `getByRole("img", { name: /Benwa, your cream-coloured sprout/ })` assertion and its "Pause creature animation" button wait.
  - Add a `page.on("pageerror")` collector to the new tests and assert it is empty.

- [ ] **Step 2: Run the tests to verify they fail.** Start `npm run dev`, then run `npm run test:e2e`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement `World.tsx`.**
  - Port the lifecycle from the deleted `Creature.tsx`: renderer creation try/catch, ResizeObserver, IntersectionObserver, reduced-motion listener, context-lost handler, retry key, and full disposal.
  - Lighting:
    - one hemisphere light
    - one shadow-casting sun covering `HOUSE_BOUNDS`
    - one fill light
    - a warm point light per floor
  - Orthographic camera at a slight high angle: position `(centre.x + 2, centre.y + 3, 20)` looking at `(centre.x, centre.y, 0)`. Ease the frame toward the target `cameraFrame` at a rate of about 3/s.
  - Each frame:
    1. `tick` the director (with dt clamped to 0.05; when reduced motion or paused, use dt = 0 and hold the pose at t = 0).
    2. Set the rig's position and yaw from the state.
    3. `apply(poseAt(anim, animTime))`.
    4. Highlight `currentRoom`.
    5. Project `rig.headTop()` and the label anchors to CSS pixels and write `transform` on the bubble and label elements via refs. Do not use React state per frame.
  - On every new `s`:
    1. Compute `selectScene`, using `previousRoom` = `currentRoom(director)`, `pendingApprovals` = the count of `s.approvals` with status PENDING, `openAssistance` = `s.assistance.length`, and `latestAction` = `s.actions[0] ?? null`.
    2. Call `setTarget`.
    3. Run `detectReactions(prevRef, next)` and pass the result to `enqueue`.
    4. Store `prevRef`.
  - Props shown via `pose.prop`: book, letter, pencil, note, `?`, `zzz` and coins are HTML emoji or text floating next to the bubble anchor; smoke is a few grey spheres puffing upward.
  - Drop the old free-rotate button and keep the pause button.
  - Delete `Creature.tsx` and add the CSS: the house hero at 16:10 on desktop and 4:5 below 700px, the bubble, the labels and the zoom panel. Remove the dead `.habitat*`, `.room-window`, `.room-note` and `.sleep-label` rules.

- [ ] **Step 4: Run the tests to verify they pass.** Run `npm run test:e2e`, then `npm run typecheck`.

- [ ] **Step 5: Visual check.**
  - Open `/` in the browser pane at desktop size and confirm by screenshot that:
    - Benwa is visible
    - he walks when the room changes (temporarily edit `actions[0].tool` through the route mock, or start the demo worker with `npm run dev`)
    - the labels and bubble track him
  - Repeat at the mobile preset (375×812): it should start zoomed on his room with no label overflow.
  - Save `artifacts/desktop.png` and `artifacts/mobile.png` (overwriting the old ones).

- [ ] **Step 6: Checkpoint.** Run `npm run lint`, then `npm test`.

---

### Task 10: "Right now" and "Current project" panels, Home re-layout, feed badges

**Files:**
- Create: `apps/web/src/components/RightNow.tsx`, `apps/web/src/components/CurrentProject.tsx`
- Modify: `apps/web/src/components/Dashboard.tsx` (Home tab around lines 501–636); `apps/web/src/styles/global.css`
- Test: `tests/browser/dashboard.spec.ts`

**Interfaces:**
- Consumes:
  - `selectScene`, `ROOMS` and `roomForTool` (Task 1)
  - `actionStep`, `outcomeBadge`, `BADGE_LABEL` and `stageTrack` (Task 2)
  - `cycle` and `projectHistory` (Task 4)
- Produces:
  - `export default function RightNow({ s }: { s: Snapshot })`: a section labelled "Right now" containing:
    - the room icon and name
    - "What he's doing": `actions[0].intention` when `actions[0].cycleId === s.cycle?.id`, otherwise `s.creature.activity`
    - "Why": that action's `rationale`, hidden when absent
    - "Thinking": `s.creature.thought`
    - a step indicator listing Deciding, Doing, Checking, Done, with the current `actionStep` marked `aria-current="step"`; `failed`, `waiting` and `deferred` replace "Done" with "Failed", "Waiting for you" and "Deferred"
    - "started N min ago", taken from the cycle's `createdAt`
  - `export default function CurrentProject({ s, onOpenProjects }: { s: Snapshot; onOpenProjects: () => void })`: a section labelled "Current project" for the latest action's project, falling back to the newest ACTIVE project. It contains:
    - the name and stage
    - the 9-step track: a `list` with `aria-label="Project stages"` whose items carry `data-state`
    - the current stage's tasks with done/pending checkboxes (`disabled`, display only)
    - "What he's actually done": items from `projectHistory[id]` filtered to the `verified` or `demo` badge, at most 5, each with a badge
    - an "All projects" link that calls `onOpenProjects`
    - empty states "No project yet. He's still looking for one." and "Nothing verified yet."
  - The Home main column order is: house section (heading kept) → `RightNow` → `CurrentProject` → "A day in his life" feed → "How he's feeling". The old "Things he's working on" section is removed from Home; it stays on the Projects tab.
  - Each feed row gets a room-coloured icon chip (`ROOMS[roomForTool(tool)]`) and a badge pill using `BADGE_LABEL[outcomeBadge(a)]` in place of the current status words.

- [ ] **Step 1: Write the failing Playwright tests.**
  - `right now panel explains what and why`: mock `actions[0]` with `intention:"Read three competitor pricing pages"`, `rationale:"Need real price points before building"`, `cycleId` matching a `cycle` with `stage:"EXECUTING"` and status PLANNED. The "Right now" region shows both strings plus the thought, and the step item "Doing" has `aria-current="step"`.
  - `current project shows progress and real achievements`:
    - Mock a project at stage `BUILDING` with milestones DISCOVERY (real) and RESEARCH (`simulated:true`).
    - Set `projectHistory[id]` to one verified and one demo item.
    - Expect the track items to have `data-state` `done`, `demo`, …, with the 5th item `current`.
    - Expect "What he's actually done" to list both items, with badges "Verified" and "Demo".
  - `fresh install`, extended from Task 9: also expect the texts "No project yet. He's still looking for one." and "Nothing verified yet." (or a similar `RightNow` idle copy) with no page errors.
  - `feed rows show outcome badges`: a FAILED action row contains "Failed"; a simulated one contains "Demo".

- [ ] **Step 2: Run the tests to verify they fail.**

- [ ] **Step 3: Implement the two components and the `Dashboard.tsx` re-layout.** Use lucide icons consistent with the existing ones (Telescope for library, FileCode2 for study, etc.; one icon per room defined in a small map inside `RightNow.tsx` and exported for the feed). Keep the right column unchanged.

- [ ] **Step 4: Run the tests to verify they pass.** Run `npm run test:e2e`, then `npm run typecheck`.

- [ ] **Step 5: Visual check.** Screenshot Home at desktop and mobile in the browser pane. The order must read house → right now → project → feed, nothing may overlap, and the right column must be unchanged. Overwrite `artifacts/desktop.png` and `artifacts/mobile.png`.

- [ ] **Step 6: Checkpoint.** Run `npm run lint`, then `npm test`.

---

### Task 11: Docs and full verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` (the last paragraph, which starts "The supplied `sprout_creature_3d.glb`")

- [ ] **Step 1: Rewrite that paragraph.** Keep the model facts (preserved, 271,196 bytes, 18 meshes, no clips, Z-up / +X face). Then describe:
  - the dollhouse world, and that room choice comes from `selectScene` (live action plus status, with an offline worker shown asleep)
  - procedural limb animation through re-pivoted meshes
  - that reactions ignore simulated evidence
  - the existing guarantees (reduced motion, offscreen pause, disposal, HTML fallbacks)

- [ ] **Step 2: Run the full suite.** Run `npm run typecheck && npm run lint && npm test`, then `npm run test:e2e` with the dev server running. Expected: all PASS. Report any failures verbatim rather than declaring done.

- [ ] **Step 3: Final checkpoint.** Confirm the updated `artifacts/desktop.png` and `artifacts/mobile.png` show Benwa visible in the house.
