import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("backend");
  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("Essay");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-06T17:00");
  await page.getByLabel("Estimated hours").fill("2");
  await page.getByLabel("Grade weight (%)").fill("20");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
}
const draft = { type: "event_draft", title: "Work shift", start: "2026-11-04T19:00:00Z", end: "2026-11-04T20:00:00Z" };
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);

test("clarification retains context; preview stays unsaved until Apply and persists once", async ({ page }) => {
  await start(page);
  let parses = 0, schedules = 0;
  await page.route("**/assistant/parse", async (route) => {
    const body = route.request().postDataJSON();
    expect(route.request().method()).toBe("POST");
    expect(body.current_time).toBe("2026-11-04T08:00:00.000Z");
    expect(body.timezone).toBe("UTC");
    if (++parses === 1) {
      expect(body.message).toBe("I'm working tonight");
      await route.fulfill({ json: { type: "clarification", question: "What time does your shift start and end?" } });
    } else {
      expect(body.message).toContain("I'm working tonight");
      expect(body.message).toContain("What time does your shift start and end?");
      expect(body.message).toContain("7 to 8 pm");
      await route.fulfill({ json: draft });
    }
  });
  await page.route("**/schedule", async (route) => {
    schedules++;
    const body = route.request().postDataJSON();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].title).toBe("Work shift");
    expect(body.events[0].repeat_on).toEqual([]);
    expect(body.preferences.max_session_minutes).toBe(90);
    expect(body.tasks[0].title).toBe("Essay");
    await route.fulfill({ json: {
      study_blocks: [{ id: "revised", task_id: body.tasks[0].id, start: "2026-11-04T20:00:00Z", end: "2026-11-04T21:00:00Z", status: "planned" }],
      unscheduled: [{ task_id: body.tasks[0].id, minutes: 60, reason: "Limited availability" }],
    } });
  });
  await page.getByLabel("Assistant message").fill("I'm working tonight");
  await page.getByRole("button", { name: "Preview schedule", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("What time does your shift start and end?");
  expect(schedules).toBe(0);
  await page.getByLabel("Your answer").fill("7 to 8 pm");
  await page.getByRole("button", { name: "Preview schedule", exact: true }).click();
  const preview = page.getByRole("region", { name: "Revised schedule preview" });
  await expect(preview).toContainText("Work shift");
  await expect(preview).toContainText("Essay");
  await expect(preview).toContainText("1 alert");
  await preview.screenshot({ path: "test-results/assistant-preview.png" });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await saved(page)).events).toHaveLength(0);
  expect((await saved(page)).studyBlocks).toHaveLength(0);
  await expect(page.locator(".calendar-event")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(".fixed-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".fixed-event")).toHaveCount(1);
  expect((await saved(page)).events).toHaveLength(1);
  expect(schedules).toBe(1);
});

test("discard, intervening edits, mode changes and reload cannot apply a stale draft", async ({ page }) => {
  await start(page);
  await page.route("**/assistant/parse", (route) => route.fulfill({ json: draft }));
  await page.route("**/schedule", (route) => route.fulfill({ json: { study_blocks: [], unscheduled: [] } }));
  const preview = async () => {
    await page.getByLabel("Assistant message").fill("Work tonight 7 to 8 pm");
    await page.getByRole("button", { name: "Preview schedule", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  };
  await preview();
  await page.getByRole("button", { name: "Discard preview" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  expect((await saved(page)).events).toHaveLength(0);
  await preview();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Maximum session (minutes)").fill("60");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await preview();
  await page.getByLabel("Data source").selectOption("demo");
  await page.getByLabel("Data source").selectOption("backend");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await preview();
  await page.reload();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  expect((await saved(page)).events).toHaveLength(0);
});

test("parse failures, malformed drafts and schedule failures preserve the workspace", async ({ page }) => {
  await start(page);
  const before = await saved(page);
  let response: unknown = draft;
  let status = 503;
  let scheduleCalls = 0;
  await page.route("**/assistant/parse", (route) => route.fulfill({ status, json: response }));
  await page.route("**/schedule", (route) => {
    scheduleCalls++;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.getByLabel("Assistant message").fill("Work tonight 7 to 8 pm");
  for (const scenario of ["unavailable", "malformed", "schedule"] as const) {
    status = scenario === "unavailable" ? 503 : 200;
    response = scenario === "malformed" ? { ...draft, end: "invalid" } : draft;
    await page.getByRole("button", { name: "Preview schedule", exact: true }).click();
    await expect(page.getByRole("region", { name: "Schedule assistant", exact: true }).getByRole("alert")).toContainText(scenario === "unavailable" ? "Assistant unavailable" : scenario === "malformed" ? "Invalid assistant" : "500");
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
  }
  expect(scheduleCalls).toBe(1);
});
