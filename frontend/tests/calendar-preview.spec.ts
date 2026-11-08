import { test, expect } from "@playwright/test";

test("Flo previews both study placements on the affected date; Discard and Apply remain transactional", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-08T08:00:00Z"));
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const plan = {
      weekStart: "2026-11-02T00:00:00.000Z", source: "backend", topics: [], needsReplan: false,
      tasks: [{ id: "stats", name: "Statistics", estimatedTimeMinutes: 30, remainingTimeMinutes: 30,
        deadline: "2026-11-18T21:00:00.000Z", gradeWeight: 20 }],
      events: [], warnings: [],
      studyBlocks: [{ id: "original", taskId: "stats", startTime: "2026-11-18T19:30:00.000Z",
        endTime: "2026-11-18T20:00:00.000Z", status: "planned" }],
      preferences: { maxStudyTimeMinutes: 120, maxSessionTimeMinutes: 60, breakDurationMinutes: 15,
        spreadAssignments: false, sleepHours: { wakeUpTime: "08:00", bedtime: "22:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: plan, demo: { ...plan, source: "demo" } }));
  });
  const draft = { id: "d0918ca3-2325-44c8-b32f-ec2badf6fbe6", started_at: 0, kind: "event", title: "Work shift",
    start: "2026-11-18T19:00:00Z", end: "2026-11-18T20:00:00Z",
    deadline: null, estimated_minutes: null, grade_weight: null, sources: {} };
  await page.route("**/assistant/chat", route => route.fulfill({ json: {
    status: "ready", message: "Review your work shift.", draft, missing_fields: [],
  } }));
  await page.route("**/schedule", async route => {
    const body = route.request().postDataJSON();
    expect(body.events[0]).toMatchObject({ start: "2026-11-18T19:00:00.000Z", end: "2026-11-18T20:00:00.000Z" });
    await route.fulfill({ json: { study_blocks: [{ id: "new-slot", task_id: "stats",
      start: "2026-11-18T20:00:00Z", end: "2026-11-18T20:30:00Z", status: "planned" }], unscheduled: [] } });
  });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Flo", exact: true })).toBeVisible();
  const before = await saved();
  await expect(page.locator(".study-event")).toHaveCount(0); // Outside the initial week.
  await page.getByLabel("Message Flo").fill("I have work on November 18 from 7 to 8 PM");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const previous = page.locator(".calendar-preview-previous");
  const proposed = page.locator(".calendar-preview-study.calendar-preview-proposed");
  await expect(previous).toBeVisible();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(previous).toContainText("Previous");
  await expect(previous).toHaveAttribute("data-preview-start", "2026-11-18T19:30:00.000Z");
  await expect(proposed).toBeVisible();
  await expect(proposed).toContainText("Proposed");
  await expect(proposed).toHaveAttribute("data-preview-start", "2026-11-18T20:00:00.000Z");
  await expect(page.locator(".calendar-preview-fixed")).toHaveAttribute("data-preview-start", "2026-11-18T19:00:00.000Z");
  await expect(previous).toHaveCSS("border-top-style", "dashed");
  await expect(proposed).toHaveCSS("border-top-style", "solid");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    expect(await proposed.evaluate(element => getComputedStyle(element).borderTopColor)).toBe(
      theme === "light" ? "rgb(183, 121, 6)" : "rgb(244, 201, 107)");
    await page.screenshot({ path: `test-results/calendar-preview-${theme}.png`, fullPage: true });
  }
  for (const block of [previous, proposed, page.locator(".calendar-preview-fixed")]) {
    await expect(block).toHaveAttribute("role", "note");
    await block.click();
    await block.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const from = await proposed.boundingBox();
  if (!from) throw new Error("Proposed session missing");
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + 70, { steps: 12 });
  await page.mouse.up();
  await expect(proposed).toHaveAttribute("data-preview-start", "2026-11-18T20:00:00.000Z");
  expect(await saved()).toEqual(before);
  await page.getByRole("button", { name: "Discard preview", exact: true }).click();
  await expect(page.locator("[data-preview-start]")).toHaveCount(0);
  await expect(page.locator(".study-event")).toHaveCount(1);
  expect(await saved()).toEqual(before);

  // Mobile keeps its original calendar and confirms through the Flo panel.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show assistant", exact: true }).click();
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect(page.locator("[data-preview-start]")).toHaveCount(0);
  expect(await saved()).toEqual(before);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(previous).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("[data-preview-start]")).toHaveCount(0);
  await expect(page.locator(".study-event")).toHaveCount(1);
  await expect(page.locator(".fixed-event")).toHaveCount(1);
  const after = await saved();
  expect(after.events[0]).toMatchObject({ startTime: "2026-11-18T19:00:00.000Z", endTime: "2026-11-18T20:00:00.000Z" });
  expect(after.studyBlocks).toEqual([expect.objectContaining({ id: "new-slot", startTime: "2026-11-18T20:00:00.000Z", endTime: "2026-11-18T20:30:00.000Z" })]);
});
