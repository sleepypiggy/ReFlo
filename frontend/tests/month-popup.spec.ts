import { test, expect } from "@playwright/test";

test("month overflow popup follows the selected theme and its events still open", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const schedule = {
      source: "demo", weekStart: "2026-11-09T00:00:00Z", tasks: [], studyBlocks: [], warnings: [],
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60, breakDurationMinutes: 15, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
      events: Array.from({ length: 6 }, (_, index) => ({ id: `event-${index}`, name: `Monthly event ${index}`,
        startTime: `2026-11-10T${10 + index}:00:00Z`, endTime: `2026-11-10T${11 + index}:00:00Z`,
        timeMinutes: 60, remainingTimeMinutes: 60 })),
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "demo", demo: schedule, backend: { ...schedule, source: "backend" } }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const more = page.getByText(/^\+\d+ more$/);
  await more.click();
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS("background-color", "rgb(21, 23, 25)");
  await expect(popup).toHaveCSS("color", "rgb(240, 238, 233)");
  await expect(popup).toHaveCSS("border-top-color", "rgb(57, 63, 67)");
  await page.screenshot({ path: "test-results/month-popup-dark.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await more.click();
  await expect(popup).toHaveCSS("background-color", "rgb(243, 241, 236)");
  await expect(popup).toHaveCSS("color", "rgb(55, 58, 57)");
  await popup.locator(".calendar-event").first().click();
  await expect(page.getByRole("heading", { name: "Edit commitment", exact: true })).toBeVisible();
  await expect(page.getByLabel("Event name")).toHaveValue(/Monthly event/);
});
