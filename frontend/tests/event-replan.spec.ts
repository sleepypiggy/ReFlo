import { test, expect } from "@playwright/test";

const normalizeStudyBlocks = <T extends { startTime: string; endTime: string }>(blocks: T[]) =>
  blocks.map(block => ({
    ...block,
    startTime: new Date(block.startTime).toISOString(),
    endTime: new Date(block.endTime).toISOString(),
  }));

test("a failed automatic event replan saves the event and study history, then retries", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const schedule = {
      weekStart: "2026-11-09T00:00:00Z", source: "backend",
      tasks: [{ id: "essay", name: "Essay", estimatedTimeMinutes: 60, remainingTimeMinutes: 60,
        deadline: "2026-11-10T12:00:00Z", gradeWeight: 20 }], events: [], warnings: [],
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60, breakDurationMinutes: 0,
        spreadAssignments: false, sleepHours: { wakeUpTime: "09:00", bedtime: "12:00" } },
      studyBlocks: [
        { id: "history", taskId: "essay", startTime: "2026-11-09T09:00:00Z", endTime: "2026-11-09T10:00:00Z", status: "completed", locked: true },
        { id: "future", taskId: "essay", startTime: "2026-11-10T09:00:00Z", endTime: "2026-11-10T10:00:00Z", status: "planned" },
      ],
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" } }));
  });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);
  await page.route("**/schedule", route => route.abort());
  await page.goto("/");
  const before = await saved();
  await page.getByRole("button", { name: "Add Event", exact: true }).click();
  await page.getByLabel("Event name").fill("Concert");
  await page.getByLabel("Start datetime").fill("2026-11-10T09:00");
  await page.getByLabel("End datetime").fill("2026-11-10T10:00");
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await expect(page.locator(".error-banner")).toContainText("Commitment saved. Automatic rescheduling failed.");
  await expect(page.locator(".plan-dirty")).toBeVisible();
  const failed = await saved();
  expect(failed.events[0].name).toBe("Concert");
  expect(failed.events[0].startTime).toBe("2026-11-10T09:00:00.000Z");
  expect(failed.events[0].endTime).toBe("2026-11-10T10:00:00.000Z");
  expect(normalizeStudyBlocks(failed.studyBlocks)).toEqual(normalizeStudyBlocks(before.studyBlocks));
  expect(failed.tasks).toEqual(before.tasks);
  await page.reload();
  await expect(page.locator(".plan-dirty")).toBeVisible();
  expect((await saved()).events).toEqual(failed.events);
  await page.route("**/schedule", route => route.fulfill({ json: {
    study_blocks: [{ id: "moved", task_id: "essay", start: "2026-11-10T10:00:00Z", end: "2026-11-10T11:00:00Z", status: "planned" }], unscheduled: [],
  } }));
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  const after = await saved();
  expect(after.events).toEqual(failed.events);
  expect(normalizeStudyBlocks(after.studyBlocks)).toEqual(normalizeStudyBlocks([
    before.studyBlocks[0],
    { id: "moved", taskId: "essay", startTime: "2026-11-10T10:00:00Z", endTime: "2026-11-10T11:00:00Z", status: "planned" },
  ]));
  const review = page.getByRole("region", { name: "Latest schedule changes" });
  await expect(review).toContainText("1 moved, 0 added, 0 removed");
  await expect(review).toContainText("Previous:");
  await expect(review).toContainText("Now:");
  await expect(page.locator(".changed-study-event")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/plan-review-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Dismiss changes", exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator(".changed-study-event")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo last replan", exact: true }).click();
  const undone = await saved();
  expect(undone.events).toEqual(failed.events);
  expect(undone.tasks).toEqual(before.tasks);
  expect(normalizeStudyBlocks(undone.studyBlocks)).toEqual(normalizeStudyBlocks(before.studyBlocks));
  await expect(page.locator(".plan-dirty")).toBeVisible();
});
