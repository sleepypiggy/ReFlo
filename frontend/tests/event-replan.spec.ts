import { test, expect } from "@playwright/test";

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
  expect(failed.studyBlocks).toEqual(before.studyBlocks);
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
  expect(after.studyBlocks.find((block: { id: string }) => block.id === "history")).toEqual(before.studyBlocks[0]);
  expect(after.studyBlocks.find((block: { id: string }) => block.id === "moved").startTime).toBe("2026-11-10T10:00:00.000Z");
});
