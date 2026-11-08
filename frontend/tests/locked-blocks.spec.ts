import { test, expect } from "@playwright/test";

test("locked sessions explain why through hover, keyboard and the session dialog", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T09:29:50Z") });
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const items = [
      { id: "past", name: "Past essay", start: "2026-11-09T10:00:00Z", end: "2026-11-09T11:00:00Z", locked: false },
      { id: "started", name: "Current essay", start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z", locked: false },
      { id: "locked", name: "Locked essay", start: "2026-11-10T11:00:00Z", end: "2026-11-10T12:00:00Z", locked: true },
      { id: "future", name: "Future essay", start: "2026-11-10T09:30:00Z", end: "2026-11-10T10:30:00Z", locked: false },
    ];
    const schedule = {
      source: "backend", weekStart: "2026-11-09T00:00:00Z", events: [], warnings: [],
      tasks: items.map(item => ({ id: item.id, name: item.name, estimatedTimeMinutes: 60, remainingTimeMinutes: 60, deadline: "2026-11-13T17:00:00Z", gradeWeight: 20 })),
      studyBlocks: items.map(item => ({ id: item.id, taskId: item.id, status: "planned", startTime: item.start, endTime: item.end, locked: item.locked })),
      preferences: { maxStudyTimeMinutes: 480, maxSessionTimeMinutes: 60, breakDurationMinutes: 0, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" } }));
  });
  await page.goto("/");
  for (const [name, reason] of [["Past essay", "in the past"], ["Current essay", "already started"], ["Locked essay", "locked"]]) {
    const event = page.locator(`.calendar-event[title^="${name}"]`);
    await expect(event.locator(".session-lock-icon")).toBeVisible();
    await expect(event.locator(".calendar-event-content")).toHaveAttribute("title", new RegExp(reason));
    await event.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("note")).toContainText(reason);
    await expect(page.getByText("Why this session cannot move", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  }
  const future = page.locator('.calendar-event[title^="Future essay"]');
  await expect(future.locator(".session-lock-icon")).toHaveCount(0);
  await page.clock.runFor(31000);
  await expect(future.locator(".session-lock-icon")).toBeVisible();
  await expect(future.locator(".calendar-event-content")).toHaveAttribute("title", /already started/);
  await future.click();
  await expect(page.getByRole("dialog").getByRole("note")).toContainText("already started");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/locked-session-mobile.png", fullPage: true });
});
