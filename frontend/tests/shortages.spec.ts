import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const schedule = {
      weekStart: "2026-11-09T00:00:00Z", source: "backend", needsReplan: false,
      tasks: [{ id: "chem", name: "Chemistry", estimatedTimeMinutes: 180, remainingTimeMinutes: 180,
        deadline: "2026-11-11T17:00:00Z", gradeWeight: 20 }], events: [],
      studyBlocks: [{ id: "saved", taskId: "chem", startTime: "2026-11-10T09:00:00Z", endTime: "2026-11-10T11:00:00Z", status: "planned" }],
      warnings: [{ taskId: "chem", unscheduledMinutes: 60, reason: "Generic shortage; do not infer a cause" }],
      preferences: { maxStudyTimeMinutes: 120, maxSessionTimeMinutes: 120, breakDurationMinutes: 15,
        sleepHours: { wakeUpTime: "09:00", bedtime: "22:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" } }));
  });
  await page.goto("/");
  await page.locator(".shortage-summary").click();
}
const saved = (page: Page) => page.evaluate(() => localStorage.getItem("schedule-maker:v1"));

test("verified suggestions are informational, bounded, and invalidate after preference edits", async ({ page }) => {
  const limits: number[] = [];
  await page.route("**/schedule", async route => {
    const limit = route.request().postDataJSON().preferences.max_daily_study_minutes;
    limits.push(limit);
    const blocks = [{ id: "trial", task_id: "chem", start: "2026-11-10T09:00:00Z", end: "2026-11-10T11:00:00Z", status: "planned" }];
    if (limit > 120) blocks.push({ id: "extra", task_id: "chem", start: "2026-11-11T09:00:00Z", end: "2026-11-11T10:00:00Z", status: "planned" });
    await route.fulfill({ json: { study_blocks: blocks, unscheduled: limit === 120 ? [{ task_id: "chem", minutes: 60, reason: "Generic" }] : [] } });
  });
  await start(page);
  const before = await saved(page);
  await expect(page.locator(".shortage-breakdown")).toContainText("Chemistry needs 3 hours; 2 hours are scheduled; 1 hour remains unscheduled");
  await expect(page.locator(".shortage-breakdown")).not.toContainText("Generic shortage");
  await page.getByRole("button", { name: "Check daily-limit suggestions" }).click();
  await expect(page.locator(".shortage-content")).toContainText("All remaining work fits.");
  expect(limits).toEqual([120, 150, 180, 240]);
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole("region", { name: "Latest schedule changes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Maximum daily study (hours)").fill("2.5");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.locator(".shortage-summary").click();
  await expect(page.locator(".shortage-content")).toContainText("These shortages are out of date");
  await expect(page.locator(".shortage-content")).not.toContainText("All remaining work fits.");
  await expect(page.getByRole("button", { name: "Check daily-limit suggestions" })).toHaveCount(0);
  expect(limits).toHaveLength(4);
});

test("failed suggestions preserve the plan and can be retried", async ({ page }) => {
  await page.route("**/schedule", route => route.abort());
  await start(page);
  const before = await saved(page);
  await page.getByRole("button", { name: "Check daily-limit suggestions" }).click();
  await expect(page.locator(".shortage-content")).toContainText("Could not check suggestions. Your saved plan is unchanged.");
  await expect(page.getByRole("button", { name: "Check daily-limit suggestions" })).toBeEnabled();
  expect(await saved(page)).toEqual(before);
});

test("an edit while checks are pending cannot publish old suggestions", async ({ page }) => {
  let pending = false;
  await page.route("**/schedule", async route => {
    pending = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({ json: { study_blocks: [], unscheduled: [] } }).catch(() => {});
  });
  await start(page);
  await page.getByRole("button", { name: "Check daily-limit suggestions" }).click();
  await expect.poll(() => pending).toBe(true);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Break duration (minutes)").fill("30");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.locator(".shortage-summary").click();
  await expect(page.locator(".shortage-content")).toContainText("These shortages are out of date");
  await expect(page.locator(".shortage-content")).not.toContainText("All remaining work fits");
  await expect(page.locator(".shortage-content")).not.toContainText("Could not check suggestions");
});
