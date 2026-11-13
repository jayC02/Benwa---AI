import { test, expect } from "@playwright/test";
test("Start stays usable while a launch awaits review and does not approve it", async ({
  page,
}) => {
  const state = await (await page.request.get("/api/state")).json();
  state.creature.status = "WAITING_APPROVAL";
  state.workerOnline = true;
  const action = state.actions[0];
  state.approvals = [
    {
      id: "browser-review",
      actionId: action.id,
      kind: "publish",
      description: "Review a launch proposal; other local work can continue.",
      status: "PENDING",
      reviewedAt: null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      action,
    },
  ];
  const commands: unknown[] = [];
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.route("**/api/control", async (route) => {
    commands.push(route.request().postDataJSON());
    state.creature.status = "RUNNING";
    await route.fulfill({
      json: {
        ok: true,
        notice:
          "Benwa is continuing other local work. Your pending requests still need review.",
      },
    });
  });
  const firstPoll = page.waitForResponse((response) =>
    response.url().endsWith("/api/state"),
  );
  await page.goto("/");
  await firstPoll;
  await expect(
    page.getByRole("button", { name: "Review request", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Benwa", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start Benwa", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  expect(commands).toEqual([{ command: "start" }]);
  expect(state.approvals[0].status).toBe("PENDING");
  await page
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record approval" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Review a launch proposal; other local work can continue.", {
        exact: true,
      }),
  ).toBeVisible();
});
test("dashboard renders, saves boundaries, and navigates at desktop and mobile sizes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hello, Benwa." }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Benwa, your cream-coloured sprout/ }),
  ).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(6);
  await page
    .getByRole("button", { name: "Pause creature animation", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const originalInterval = await page
    .getByLabel("Seconds between decisions")
    .inputValue();
  await page.getByLabel("Seconds between decisions").fill("5");
  await page.getByRole("button", { name: "Save boundaries" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByLabel("Seconds between decisions").fill(originalInterval);
  await page.getByRole("button", { name: "Save boundaries" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  // Only capture once a frame with Benwa in it has actually been drawn.
  await expect(
    page.getByRole("img", { name: /Benwa, your cream-coloured sprout/ }),
  ).toHaveAttribute("data-model-state", "ready", { timeout: 20000 });
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Hello, Benwa." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
});
test("rejects cross-origin control requests and financial fabrication", async ({
  page,
}) => {
  await page.goto("/");
  const blocked = await page.request.post("/api/control", {
    data: { command: "start" },
    headers: { origin: "https://untrusted.invalid" },
  });
  expect(blocked.status()).toBe(403);
  const forged = await page.request.post("/api/finance", {
    data: { source: "llm", kind: "REVENUE", amountMinor: "10000" },
    headers: { origin: "http://127.0.0.1:4321" },
  });
  expect(forged.status()).toBe(400);
});

test("shows honest model quota monitoring without changing the creature view", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Pause creature animation", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Model routing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Locally observed requests and configured ceilings, not Google-confirmed remaining quota.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("row")).toHaveCount(14);
  await expect(
    page.getByRole("row").filter({ hasText: "Gemini 4 Hydrogen" }),
  ).toContainText("Complex tasks only");
  await expect(
    page.getByRole("row").filter({ hasText: "Gemma 4 31B" }),
  ).toContainText(/Experimental summaries disabled|Plain-text summaries only/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/gemini-monitor-mobile.png",
    fullPage: true,
  });
});
