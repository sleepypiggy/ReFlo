import { test, expect } from "@playwright/test";

test("Preferences rejects session maxima below 15 and saves the boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  const session = page.getByLabel("Maximum session (minutes)", { exact: true });
  await expect(session).toHaveAttribute("min", "15");
  await expect(session).toHaveAccessibleDescription(/at least 15 minutes/);
  await session.fill("14");
  await page.getByRole("button", { name: "Save preferences" }).click();
  expect(await session.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  await expect(session).toBeVisible();
  await session.fill("15");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(session).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(session).toHaveValue("15");
});

test("Real backend shortages display the specific small-work explanation", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.addInitScript(() => {
    const schedule = {
      weekStart: "2026-11-09T00:00:00Z", source: "backend", needsReplan: false,
      tasks: [{ id: "small", name: "Quick review", estimatedTimeMinutes: 8, remainingTimeMinutes: 8,
        deadline: "2026-11-10T12:00:00Z", gradeWeight: 20 }], events: [], studyBlocks: [],
      warnings: [{ taskId: "small", unscheduledMinutes: 8,
        reason: "Remaining unscheduled work is below the 15-minute minimum study block; your work estimate has not been rounded up." }],
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 15, breakDurationMinutes: 0,
        sleepHours: { wakeUpTime: "09:00", bedtime: "22:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: schedule, demo: schedule }));
  });
  await page.goto("/");
  await page.locator(".shortage-summary").click();
  await expect(page.locator(".shortage-breakdown")).toContainText("8 minutes remain unscheduled");
  await expect(page.locator(".shortage-breakdown")).toContainText("15-minute minimum session length");
  await expect(page.locator(".shortage-breakdown")).toContainText("Your estimate is unchanged");
});
