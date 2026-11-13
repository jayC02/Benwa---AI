import { test, expect, type Page } from "@playwright/test";

type State = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function withState(page: Page, change: (s: State) => void) {
  const state = (await (await page.request.get("/api/state")).json()) as State;
  change(state);
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The page renders server data first; the mocked state arrives on the first poll.
  const firstPoll = page.waitForResponse((r) => r.url().endsWith("/api/state"));
  await page.goto("/");
  await firstPoll;
  return { state, errors };
}

function executing(s: State, tool: string) {
  s.creature.status = "RUNNING";
  s.workerOnline = true;
  s.approvals = [];
  s.assistance = [];
  const base = s.actions[0] ?? {
    id: "mock-action",
    projectId: s.projects[0]?.id ?? "p",
    goalId: "g",
    category: "build",
    target: "x",
    rationale: "",
    strategy: "s",
    input: {},
    expectedEvidence: "",
    costEstimateMinor: "0",
    permissions: [],
    fingerprint: "f",
    createdAt: new Date().toISOString(),
    completedAt: null,
    outcome: null,
    executions: [],
  };
  s.cycle = {
    id: "mock-cycle",
    stage: "EXECUTING",
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  s.actions = [
    {
      ...base,
      cycleId: "mock-cycle",
      tool,
      status: "PLANNED",
      outcome: null,
      intention: base.intention ?? "Doing something",
    },
    ...s.actions.slice(1),
  ];
}

const house = (page: Page) =>
  page.getByRole("img", { name: /Benwa, your cream-coloured sprout creature/ });

test("house shows Benwa in the room matching his action", async ({ page }) => {
  const { errors } = await withState(page, (s) =>
    executing(s, "research.fetch"),
  );
  await expect(house(page)).toHaveAttribute("data-room", "library");
  await expect(house(page)).toHaveAttribute("data-activity", "work");
  await expect(house(page)).toHaveAttribute("aria-label", /in the library/);
  await expect(house(page)).toHaveAttribute("data-model-state", "ready", {
    timeout: 20000,
  });
  expect(errors).toEqual([]);
});

test("thought bubble shows his thought", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "workspace.write");
    s.creature.thought = "Maybe a tiny invoice tool?";
  });
  await expect(page.getByTestId("thought-bubble")).toContainText(
    "Maybe a tiny invoice tool?",
  );
});

test("clicking a room zooms and lists what he did there", async ({ page }) => {
  await withState(page, (s) => executing(s, "research.fetch"));
  await expect(house(page)).toHaveAttribute("data-model-state", "ready", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "Look in the Study" }).click();
  await expect(
    page.getByRole("region", { name: "What he's done in the Study" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Whole house" }).click();
  await expect(
    page.getByRole("region", { name: "What he's done in the Study" }),
  ).toHaveCount(0);
});

test("offline worker shows sleeping", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    s.workerOnline = false;
  });
  await expect(house(page)).toHaveAttribute("data-room", "bedroom");
  await expect(house(page)).toHaveAttribute("data-activity", "sleep");
  await expect(page.locator(".world-status")).toContainText("Worker offline");
});

test("fresh install", async ({ page }) => {
  const { errors } = await withState(page, (s) => {
    s.actions = [];
    s.projects = [];
    s.cycle = null;
    s.projectHistory = {};
    for (const key of Object.keys(s.roomHistory)) s.roomHistory[key] = [];
    s.creature.status = "PAUSED";
    s.workerOnline = true;
    s.approvals = [];
    s.assistance = [];
  });
  await expect(house(page)).toHaveAttribute("data-room", "bedroom");
  await expect(house(page)).toHaveAttribute("data-model-state", "ready", {
    timeout: 20000,
  });
  expect(errors).toEqual([]);
});

const right = (page: Page) => page.getByRole("region", { name: "Right now" });
const project = (page: Page) =>
  page.getByRole("region", { name: "Current project" });

test("right now panel explains what and why", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    s.actions[0].intention = "Read three competitor pricing pages";
    s.actions[0].rationale = "Need real price points before building";
    s.creature.thought = "Prices first, then the tool.";
  });
  await expect(right(page)).toContainText(
    "Read three competitor pricing pages",
  );
  await expect(right(page)).toContainText(
    "Need real price points before building",
  );
  await expect(right(page)).toContainText("Prices first, then the tool.");
  await expect(right(page)).toContainText("Library");
  await expect(
    right(page).getByRole("listitem").filter({ hasText: "Doing" }),
  ).toHaveAttribute("aria-current", "step");
});

test("current project shows progress and real achievements", async ({
  page,
}) => {
  await withState(page, (s) => {
    executing(s, "workspace.write");
    const id = "mock-project";
    s.actions[0].projectId = id;
    s.projects = [
      {
        id,
        name: "Invoice Sprout",
        description: "A tiny invoice tool",
        stage: "BUILDING",
        status: "ACTIVE",
        score: 0,
        hypothesis: {},
        verifiedMilestones: 2,
        stagnantAttempts: 0,
        progressAt: new Date().toISOString(),
        stageChangedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: [
          {
            id: "t1",
            projectId: id,
            title: "Write the first page",
            status: "DONE",
            dependsOnId: null,
            stage: "BUILDING",
          },
          {
            id: "t2",
            projectId: id,
            title: "Add a total box",
            status: "PENDING",
            dependsOnId: null,
            stage: "BUILDING",
          },
        ],
        milestones: [
          {
            id: "m1",
            projectId: id,
            stage: "DISCOVERY",
            evidenceActionId: "e1",
            createdAt: new Date().toISOString(),
            simulated: false,
          },
          {
            id: "m2",
            projectId: id,
            stage: "RESEARCH",
            evidenceActionId: "e2",
            createdAt: new Date().toISOString(),
            simulated: true,
          },
        ],
        experiments: [],
      },
    ];
    const item = (n: number, simulated: boolean) => ({
      id: `h${n}`,
      cycleId: `hc${n}`,
      projectId: id,
      tool: "workspace.write",
      intention: `Intent ${n}`,
      status: "SUCCEEDED",
      createdAt: new Date().toISOString(),
      outcome: {
        summary: simulated
          ? "Demo page drafted"
          : "Wrote index.html (1830 bytes)",
        verified: true,
        meaningful: true,
        simulated,
      },
    });
    s.projectHistory = { [id]: [item(1, false), item(2, true)] };
  });
  const p = project(page);
  await expect(p).toContainText("Invoice Sprout");
  const stages = p
    .getByRole("list", { name: "Project stages" })
    .getByRole("listitem");
  await expect(stages).toHaveCount(9);
  await expect(stages.nth(0)).toHaveAttribute("data-state", "done");
  await expect(stages.nth(1)).toHaveAttribute("data-state", "demo");
  await expect(stages.nth(4)).toHaveAttribute("data-state", "current");
  await expect(p).toContainText("Add a total box");
  const done = p.getByRole("list", { name: "What he's actually done" });
  await expect(done).toContainText("Wrote index.html (1830 bytes)");
  await expect(done).toContainText("Verified");
  await expect(done).toContainText("Demo page drafted");
  await expect(done).toContainText("Demo");
});

test("fresh install panels have gentle empty states", async ({ page }) => {
  const { errors } = await withState(page, (s) => {
    s.actions = [];
    s.projects = [];
    s.cycle = null;
    s.projectHistory = {};
    s.creature.status = "PAUSED";
    s.approvals = [];
    s.assistance = [];
  });
  await expect(project(page)).toContainText(
    "No project yet. He's still looking for one.",
  );
  await expect(right(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("feed rows show outcome badges", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    const base = s.actions[0];
    s.actions = [
      base,
      {
        ...base,
        id: "f1",
        cycleId: "fc1",
        tool: "sandbox.run",
        status: "FAILED",
        intention: "Run the calculator tests",
        outcome: null,
      },
      {
        ...base,
        id: "f2",
        cycleId: "fc2",
        tool: "workspace.write",
        status: "SUCCEEDED",
        intention: "Write demo notes",
        outcome: {
          ...(base.outcome ?? {}),
          summary: "Demo notes written",
          verified: true,
          meaningful: true,
          simulated: true,
          evidence: {},
          evidenceHash: null,
          id: "o2",
          actionId: "f2",
          createdAt: base.createdAt,
        },
      },
    ];
  });
  const feed = page.locator(".activity-section");
  await expect(
    feed
      .locator(".timeline-row")
      .filter({ hasText: "Run the calculator tests" }),
  ).toContainText("Failed");
  await expect(
    feed.locator(".timeline-row").filter({ hasText: "Demo notes written" }),
  ).toContainText("Demo");
});

test("paused Benwa shows no in-progress step", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    s.creature.status = "PAUSED";
    s.cycle.stage = "DECIDING";
  });
  await expect(right(page)).toContainText("Bedroom");
  await expect(
    right(page).getByRole("list", { name: "Progress on this step" }),
  ).toHaveCount(0);
});

test("offline worker: right now shows no stale intention", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    s.actions[0].intention = "Read three competitor pricing pages";
    s.actions[0].rationale = "Need real price points before building";
    s.workerOnline = false;
  });
  await expect(right(page)).toContainText("Worker offline");
  await expect(right(page)).not.toContainText(
    "Read three competitor pricing pages",
  );
  await expect(right(page)).not.toContainText("Need real price points");
});

test("confused: panel and house agree on the room", async ({ page }) => {
  await withState(page, (s) => {
    executing(s, "research.fetch");
    s.creature.status = "REVIEW_REQUIRED";
  });
  await expect(house(page)).toHaveAttribute("data-activity", "confused");
  await expect(house(page)).toHaveAttribute("data-model-state", "ready", {
    timeout: 20000,
  });
  const room = await house(page).getAttribute("data-room");
  const names: Record<string, string> = {
    hall: "Front hall",
    study: "Study",
    workshop: "Workshop",
    library: "Library",
    planning: "Planning room",
    journal: "Journal nook",
    bedroom: "Bedroom",
  };
  await expect(right(page).locator(".right-now-head strong")).toContainText(
    names[room!],
  );
  await expect(right(page)).toContainText("a little confused");
});

test("phone can switch to the whole house and back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withState(page, (s) => executing(s, "research.fetch"));
  await expect(house(page)).toHaveAttribute("data-model-state", "ready", {
    timeout: 20000,
  });
  const workshop = page.getByRole("button", { name: "Look in the Workshop" });
  await expect(workshop).toBeHidden();
  await page.getByRole("button", { name: "Whole house" }).click();
  await expect(workshop).toBeVisible();
  await expect(workshop).toBeInViewport();
});
