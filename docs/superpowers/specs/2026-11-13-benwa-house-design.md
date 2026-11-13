# Benwa's House: dollhouse world, animation and "what's he up to" UI

Date: 2026-11-13
Status: approved 2026-11-13

## Intent

Benwa is an autonomous agent whose goal is to make money and build small businesses. Today the dashboard shows him as a static model on a round platform (desk and plant) that barely moves whatever he is doing. The owner wants the dashboard to feel like watching a little creature live his life: a 3D house where each room matches a kind of work, and Benwa walks between rooms and plays an animation that fits what he is really doing at that moment.

It should serve three purposes at once:

- **A pet you check in on.** It should be charming and alive.
- **A live window into the agent.** At a glance you can see which room he's in, what he's doing, why, and what he's thinking.
- **A showcase.** It should be fun to show other people.

Inspiration came from "Pino's world", but Benwa must have his own identity. Do not copy that project's look, layout or characters.

Rough, low-poly, slightly janky visuals and animation are fine and **part of the vibe**. Polish is not the goal. Personality and legibility are.

## Goals

1. Replace the current habitat with a **dollhouse cutaway house**: the house seen side-on with the front wall removed, so every room is visible at once.
2. Make Benwa **walk to the room matching his current real activity** and play a room-specific animation there.
3. Animate Benwa procedurally (walk, climb, type, read, tinker, write, sleep, celebrate, fail, confused) using the limb meshes already in his model.
4. Rework the Home UI so it is obvious:
   - what he is doing **right now**, why, and what he's thinking
   - which project and task it serves
   - what he has **actually done** towards it, meaning verified outcomes and milestones as opposed to intentions
5. Fix the existing bug where the creature model does not appear (see `artifacts/desktop.png`, where only the room is visible).

## Non-goals

- No changes to the agent's decision-making, tools, worker, supervisor, ledger or database schema. This is a front-end change plus **additive read-only queries in `snapshot.ts`**. The only snapshot additions are:
  - **current cycle:** the latest `AgentCycle` (stage, createdAt, completedAt), which drives the "Deciding" step and room rules 5 and 6
  - **per-project outcomes:** for each active project, its last ~8 actions with outcomes, so "What he's actually done" doesn't depend on the global latest-40
  - **room history:** the last ~6 actions per tool group, for the room zoom panel
  - **milestone evidence:** each milestone's evidence outcome `simulated` flag, so demo milestones can be shown differently
- No rigging, no Blender work, no new art files for Benwa. The supplied `sprout_creature_3d.glb` (identical to `apps/web/public/models/benwa.glb`) is used as-is.
- No free-roam/open world, outdoor area or orbit camera (possible later).
- No public read-only showcase page. The dashboard stays behind the existing auth, and a public view is a separate follow-up.
- No sound.

## Anti-goals (failure even if it "works")

- **The house lies.** Benwa must never appear to be doing something he isn't. The room and animation must come from his real latest action and status, and when nothing is happening he should look idle or asleep rather than busy.
- The UI blurs "intended" and "achieved". Verified outcomes, simulated/demo evidence and failures must stay visibly distinct, as they are today.
- Safety and control features get buried: approvals, emergency stop, the supervisor panel, the ledger and the human-assistance panel must remain as reachable as now.
- It tanks performance on an ordinary laptop or phone, or it drops the existing accessibility behaviour: reduced-motion support, pausing when offscreen or hidden, HTML fallbacks for WebGL failure, and an aria description of what he's doing.

## Constraints and facts

- **Stack:** Astro 7 + React 19 + Three.js 0.180 (already installed), with Tailwind and hand-written CSS in `apps/web/src/styles/global.css`. No game engine and no heavy new dependencies.
- **Current scene:** `apps/web/src/components/Creature.tsx`. The Home layout is in `apps/web/src/components/Dashboard.tsx` (the Home tab, around line 501 onwards).
- **Data:** `apps/web/src/server/snapshot.ts`, polled from `/api/state` every 4s (20s when the tab is hidden). It already includes:
  - `creature`: status, activity, thought, mood, energy, curiosity, boredom, confidence, frustration
  - `actions` (latest 40): tool, intention, rationale, status, createdAt, completedAt, plus outcome (summary, verified, meaningful, simulated)
  - `projects`: stage, verifiedMilestones, milestones, tasks (title, status, stage), experiments
  - `approvals`, `assistance`, `finance`
- **Model:** Z-up, face along +X, 18 separate meshes with **no skeleton and no animation clips**. The meshes are body, left/right leg, left/right foot, left/right arm, left/right hand, eyeballs, pupils, stem, two leaf stems and two leaves. Limb geometry is baked in model space, so each limb needs re-pivoting at its joint (hip, shoulder, stem base) before it can rotate. The current code already does this for the eyes.
- **Pace:** an agent cycle is about 25s by default, and polling every 4s means room changes arrive at most about every 4s. Walks need to finish in a few seconds, and if a new target arrives mid-walk he should re-route.
- **Tools:** `research.search`, `research.fetch`, `workspace.write`, `workspace.read`, `workspace.inspect`, `sandbox.run`, `browser.test`, `project.plan`, `project.advance`, `project.reject`, `memory.learn`, `rest`, `external.request`.
- **Creature statuses seen in code:** RUNNING, RESTING, PAUSED, WAITING_APPROVAL, BUDGET_PAUSED, QUOTA_PAUSED, REVIEW_REQUIRED, ERROR.
- **Action statuses:** PLANNED, SUCCEEDED, FAILED, AWAITING_APPROVAL, DEFERRED.
- **Project stages:** DISCOVERY → RESEARCH → VALIDATION → PLANNING → BUILDING → TESTING → LAUNCH_APPROVAL → OPERATION → REVENUE_EVALUATION.

## Approaches considered

1. **Dollhouse cutaway (chosen).** One house seen side-on with the front wall removed. All rooms are visible, the camera follows Benwa, and clicking a room zooms in. It is the easiest to read at a glance, it delivers the feeling of watching him wander, and it is the simplest option that still feels like a world.
2. **One room at a time.** A separate scene per room, with a fade between them. It is cheaper, but he never visibly travels, which loses the exploring feel.
3. **Open world.** The house sits in an orbitable outdoor area. It is the most "world", but it is the most work and the hardest to read at a glance. It could grow out of option 1 later.

Animation approach: procedural animation in code by rotating the existing limb meshes (chosen) versus rigging plus clip animations (rejected because it costs more and the owner explicitly prefers a rough look).

## Decided design

### The house

There are seven rooms on two floors plus an attic, all built in code from simple boxes and cylinders in a low-poly, flat-shaded, warm palette, with one stair or ladder column connecting the floors. Each room has a small sign with its name.

| Room | Floor | Triggered by | Props (rough) | Looping animation |
|---|---|---|---|---|
| Front hall | Ground | `external.request`; creature status WAITING_APPROVAL; any action AWAITING_APPROVAL | Front door, postbox, bench | Posts a letter, then waits, tapping his foot and glancing at the door |
| Study | Ground | `workspace.write` / `read` / `inspect` | Desk, chunky computer, mug | Types, leans in, occasional head scratch |
| Workshop | Ground | `sandbox.run`, `browser.test` | Workbench, a "machine" box with a blinking light | Pokes and turns things on the machine |
| Library | First | `research.search`, `research.fetch` | Bookshelves, armchair, lamp | Pulls a book, reads, flips pages |
| Planning room | First | `project.plan`, `project.advance`, `project.reject` | Corkboard with notes and string | Pins notes and steps back to look |
| Journal nook | First | `memory.learn` | Small desk, notebook, candle | Scribbles in a notebook |
| Bedroom (attic) | Attic | `rest` tool; creature status RESTING, PAUSED, BUDGET_PAUSED, QUOTA_PAUSED | Bed, window, "z z z" | Sleeps (RESTING) or sits on the bed idling (paused states) |

**Room selection rule** *(builder's call, after review)*

The first matching rule wins:

1. The worker is offline (`workerOnline === false`): **bedroom**, asleep, labelled "Worker offline". He can't be doing anything, so he must not look busy.
2. REVIEW_REQUIRED or ERROR: he stays in his current room and plays the **confused** animation.
3. WAITING_APPROVAL or WAITING_ASSISTANCE, or any approval still PENDING, or any open assistance request: **front hall**, waiting by the door.
4. RESTING, PAUSED, BUDGET_PAUSED or QUOTA_PAUSED: **bedroom** (sleeping when RESTING, sitting on the bed for the paused states).
5. RUNNING with the current cycle in an execution or verification stage: the room comes from that action's tool, and he plays the room loop.
6. RUNNING while the current cycle is DECIDING, or the latest action has already finished: he **stays in the room of his last action** and plays a "pondering" idle (hand to chin, "…" in the thought bubble). He only walks once a new action appears, so he never looks busy over finished work.
7. No actions ever: **bedroom**.

A DEFERRED `external.request` (independent autonomy mode) counts as the front hall only while it is the latest action and the cycle is executing it. Afterwards, rule 6 applies.

The room-from-state function is pure and unit-tested against each rule and their precedence.

### One-off reactions

These trigger on changes between snapshots and are queued so they don't overlap:

- A new outcome that is verified and meaningful plays a small happy hop.
- A new FAILED action plays a puff of smoke and a slump.
- A new project milestone plays a celebration dance, but only if the milestone's evidence outcome is not simulated.
- An increase in realised net profit plays a big celebration with coins.
- Simulated/demo outcomes never trigger the "verified" reactions.

### Animation

Benwa is animated procedurally by rotating the re-pivoted limbs and adding body bob, squash and lean:

- idle (breathing, blinking, leaf sway)
- walk (alternating legs and arms, body bob)
- climb (on the stair column)
- the seven room loops above
- the four one-off reactions
- confused (head tilt with a "?" mark)

Slightly stiff, stepped motion is acceptable. Movement is waypoint-based: he walks to the stair column, changes floor, then walks to the room's "work spot". If a new target arrives mid-walk, he re-routes from his current position.

### Camera and interaction

- The default camera frames the whole house and gently follows Benwa.
- Clicking a room, or its label, zooms in on that room and shows a small panel listing the recent actions he has done in that room. A "Whole house" button returns to the full view.
- Rotate controls and free orbit are removed. The pause-motion button stays.
- On narrow screens, the default view is zoomed on his current room rather than the whole house.

### Thought bubble

A speech/thought bubble drawn in HTML and anchored above his head in the 3D view shows `creature.thought` (truncated, with the full text available in the side panel). While sleeping it shows "z z z" instead.

### Home UI rework

The order of the Home tab main column becomes:

1. **House hero.** The 3D house is the widest element, with the room label and the thought bubble on it.
2. **"Right now" panel**, directly under the house:
   - the room icon and name
   - **What he's doing:** the latest action's intention, falling back to `creature.activity`
   - **Why:** the latest action's rationale
   - **Thinking:** `creature.thought`
   - a step indicator for the current action (Deciding → Doing → Checking → Done / Failed / Waiting for you), derived from the current cycle's stage plus the action status and outcome
   - how long ago it started
3. **"Current project" card** for the project of the latest action:
   - the name
   - a **9-stage progress track**: stages with a real milestone get a solid tick, stages whose milestone rests on demo/simulated evidence get a hollow tick labelled "demo", and the current stage is highlighted
   - the task checklist for the current stage (done/pending)
   - **"What he's actually done"**: the last few verified, meaningful outcomes for this project, with the simulated/demo badge kept
   - a link to the full project
4. **Activity feed** ("A day in his life"), kept, with each row now tagged with its room icon and colour plus a clear outcome badge: Verified / Failed / Demo / Waiting / Deferred.
5. **Feelings meters**, kept but more compact (moved below, or merged into a small strip).

The right column (nest egg, supervisor, approvals and assistance, memories) is unchanged in content. Approval and assistance requests stay prominent.

### Bug to fix

The model is not visible in `artifacts/desktop.png`. Diagnose the cause (load, scale, camera framing or orientation) as part of the work, and add a check so it can't silently regress, for example a browser test asserting the model reached the "ready" state.

## Left to the builder

- Exact room dimensions, colours, prop shapes and floor layout within "two floors plus attic, seven rooms, one stair column".
- Joint pivot positions for each limb, animation curves and timings.
- How to split the code into modules (e.g. a house builder, a Benwa rig/animator, room logic, camera director) and whether to keep it imperative Three.js or adopt `@react-three/fiber`. The default is to stay with plain Three.js, as the existing code does.
- Icons and exact copy for the new panels, matching the existing gentle tone ("A day in his life", "His little nest egg").
- How reactions are detected between snapshots (e.g. tracking seen action IDs and the previous net profit).
- Test coverage: unit tests for room selection, step derivation and reaction detection, plus updating `tests/browser/dashboard.spec.ts` for the new layout.
