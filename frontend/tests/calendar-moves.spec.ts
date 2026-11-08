import { test, expect, type Page } from "@playwright/test";
import { initialWorkspace } from "../src/lib/storage";
import { Task } from "../src/datatypes";

async function drag(page: Page, title: string, sourceDay: string, targetDay: string, fromHour: string, toHour = fromHour) {
  const event = page.locator(`[role="cell"][data-date="${sourceDay}"] .calendar-event[title="${title}"]`);
  await event.scrollIntoViewIfNeeded();
  const box = (await event.boundingBox())!;
  const day = (await page.locator(`[role="cell"][data-date="${targetDay}"]`).boundingBox())!;
  const from = (await page.locator(`[data-time="${fromHour}:00:00"]`).first().boundingBox())!;
  const to = (await page.locator(`[data-time="${toHour}:00:00"]`).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + 10, { steps: 3 });
  await page.mouse.move(day.x + day.width / 2, box.y + 10 + to.y - from.y, { steps: 20 });
  await page.mouse.up();
}

test("drag saves study placement, reverts a conflict and moves only one recurring occurrence", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-09T08:00:00Z"));
  const workspace = initialWorkspace();
  workspace.demo = { ...workspace.backend, source: "demo", weekStart: new Date("2026-11-09T00:00:00Z"),
    tasks: [new Task({ id: "task", name: "Essay", estimatedTimeMinutes: 180, deadline: new Date("2026-11-20T17:00:00Z"), gradeWeight: 20 })],
    studyBlocks: [{ id: "study", taskId: "task", status: "planned", startTime: new Date("2026-11-10T10:00:00Z"), endTime: new Date("2026-11-10T11:00:00Z") }],
    events: [{ id: "class", name: "Lecture", timeMinutes: 60, remainingTimeMinutes: 60,
      startTime: new Date("2026-11-10T12:00:00Z"), endTime: new Date("2026-11-10T13:00:00Z"), repeatOn: [2, 3] }] };
  await page.addInitScript(value => {
    if (!localStorage.getItem("schedule-maker:v1")) localStorage.setItem("schedule-maker:v1", value);
  }, JSON.stringify(workspace));
  await page.goto("/");
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).demo);
  await drag(page, "Essay", "2026-11-10", "2026-11-11", "10");
  await expect(page.getByText("Session moved and saved.", { exact: false })).toBeVisible();
  expect((await saved()).studyBlocks[0].startTime).toBe("2026-11-11T10:00:00.000Z");
  expect((await saved()).studyBlocks[0].manuallyMoved).toBe(true);
  await page.reload();
  await drag(page, "Essay", "2026-11-11", "2026-11-11", "10", "12");
  await expect(page.locator('.error-banner[role="alert"]')).toContainText("Move reverted. The session overlaps a fixed commitment.");
  expect((await saved()).studyBlocks[0].startTime).toBe("2026-11-11T10:00:00.000Z");
  await expect(page.locator('[role="cell"][data-date="2026-11-11"] .calendar-event[title="Essay"] .calendar-event-time')).toContainText("10:00");
  await drag(page, "Lecture", "2026-11-10", "2026-11-12", "12");
  await expect(page.getByText("Commitment moved.", { exact: false })).toBeVisible();
  expect((await saved()).events[0].excludedStarts).toEqual(["2026-11-10T12:00:00.000Z"]);
  expect((await saved()).events[1].startTime).toBe("2026-11-12T12:00:00.000Z");
  expect((await saved()).needsReplan).toBe(true);
  expect((await saved()).tasks[0].remainingTimeMinutes).toBe(180);
  expect((await saved()).tasks[0].deadline).toBe("2026-11-20T17:00:00.000Z");
  await page.reload();
  await expect(page.locator('[role="cell"][data-date="2026-11-10"] .calendar-event[title="Lecture"]')).toHaveCount(0);
  await expect(page.locator('[role="cell"][data-date="2026-11-11"] .calendar-event[title="Lecture"]')).toHaveCount(1);
  await expect(page.locator('[role="cell"][data-date="2026-11-12"] .calendar-event[title="Lecture"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.getByText("Mock timetable refreshed.", { exact: false })).toBeVisible();
  expect((await saved()).studyBlocks[0].startTime).toBe("2026-11-11T10:00:00.000Z");
});
