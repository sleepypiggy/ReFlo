import { test, expect, type Page } from "@playwright/test";

// Real browser requests go through CORS to a separate FastAPI process. No API
// routes are intercepted. Fixed commitments leave exactly the prototype windows.
async function savedPlan(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);
}

test("real Python planning, unfinished work, work-shift shortage, and persistence", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T15:00:00-07:00"));
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const at = (day: number, clock: string) => `2026-11-${day}T${clock}:00-07:00`;
    const ranges = [[10, "07:00", "16:00"], [10, "18:15", "23:00"],
      [11, "07:00", "09:00"], [11, "11:15", "23:00"],
      [12, "07:00", "18:15"], [12, "19:15", "23:00"]] as const;
    const schedule = {
      weekStart: "2026-11-09T00:00:00-07:00", source: "backend",
      tasks: [{ id: "stats", name: "Statistics assignment", estimatedTimeMinutes: 240,
        remainingTimeMinutes: 240, deadline: at(12, "19:15"), gradeWeight: 20 }],
      events: ranges.map(([day, start, end], index) => ({
        id: `busy-${index}`, name: `Fixed commitment ${index}`,
        startTime: at(day, start), endTime: at(day, end), timeMinutes: 60, remainingTimeMinutes: 60,
      })),
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60,
        breakDurationMinutes: 15, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
      studyBlocks: [], warnings: [],
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({
      mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" },
    }));
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Statistics assignment", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Test backend/ }).click();
  await expect(page.getByRole("button", { name: /Test backend/ })).toContainText("Connected");
  const initialResponse = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  const initial = await (await initialResponse).json();
  expect(initial.study_blocks).toHaveLength(4);
  expect(initial.unscheduled).toEqual([]);
  await expect(page.locator(".study-event")).toHaveCount(4);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  const first = await savedPlan(page);
  expect(first.studyBlocks).toHaveLength(4);

  await page.clock.setFixedTime(new Date("2026-11-10T20:00:00-07:00"));
  await page.locator(".study-event").filter({ hasText: "Statistics" }).first().click();
  await page.getByRole("button", { name: "I Didn't Finish", exact: true }).click();
  await page.getByLabel("Total assignment work remaining (minutes)").fill("180");
  const replanResponse = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save remaining & reschedule" }).click();
  const replanned = await (await replanResponse).json();
  expect(replanned.study_blocks).toHaveLength(3);
  expect(replanned.unscheduled).toEqual([]);
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(4);
  const history = (await savedPlan(page)).studyBlocks.filter((block: { startTime: string }) =>
    new Date(block.startTime) < new Date("2026-11-10T20:00:00-07:00"));
  expect(history).toHaveLength(2);

  await page.getByRole("button", { name: "Add Event", exact: true }).click();
  await page.getByLabel("Event name").fill("Thursday work shift");
  await page.getByLabel("Start datetime").fill("2026-11-12T18:15");
  await page.getByLabel("End datetime").fill("2026-11-12T19:15");
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  const shortageResponse = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  const shortage = await (await shortageResponse).json();
  expect(shortage.study_blocks).toHaveLength(2);
  expect(shortage.unscheduled[0].minutes).toBe(60);
  await expect(page.locator(".task-warning")).toContainText("1h still needs a time slot");
  await page.reload();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(3);
  const persisted = await savedPlan(page);
  expect(persisted.tasks[0].remainingTimeMinutes).toBe(180);
  expect(persisted.studyBlocks.filter((block: { id: string }) => history.some((old: { id: string }) => old.id === block.id))).toHaveLength(2);
  await page.screenshot({ path: "test-results/live-dashboard.png", fullPage: true });
});
