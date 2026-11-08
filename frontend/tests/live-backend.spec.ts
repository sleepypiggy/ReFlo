import { test, expect, type Page } from "@playwright/test";

// Real browser requests go through CORS to a separate FastAPI process. No API
// routes are intercepted. Fixed commitments leave exactly the prototype windows.
async function savedPlan(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);
}

test("weighted pressure controls shortage, tied scores use deadline, and edits persist", async ({ page }) => {
  // Stay before the first waking slot even if browser and Python timezone data
  // differ by an hour; an already-started block becomes locked on regeneration.
  await page.clock.setFixedTime(new Date("2026-11-13T07:00:00-08:00"));
  await page.addInitScript(() => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const schedule = {
      weekStart: "2026-11-09T00:00:00-08:00", source: "backend",
      tasks: [
        { id: "essay", name: "Essay", estimatedTimeMinutes: 180, remainingTimeMinutes: 180,
          deadline: "2026-11-13T13:00:00-08:00", gradeWeight: 40 },
        { id: "math", name: "Math", estimatedTimeMinutes: 180, remainingTimeMinutes: 180,
          deadline: "2026-11-13T14:00:00-08:00", gradeWeight: 10 },
      ],
      events: [], studyBlocks: [], warnings: [],
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60,
        breakDurationMinutes: 0, sleepHours: { wakeUpTime: "09:00", bedtime: "14:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({
      mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" },
    }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  const panel = page.getByRole("region", { name: "Not all work fits" });
  await expect(panel.locator("summary")).toContainText("1 alert");
  await expect(panel.locator("details")).not.toHaveAttribute("open", "");
  await panel.locator("summary").click();
  await expect(panel.locator("details")).toHaveAttribute("open", "");
  await expect(panel).toContainText("6h of work");
  await expect(panel).toContainText("current plan fits 4h");
  await expect(panel).toContainText("2h remains unscheduled");
  expect((await savedPlan(page)).warnings[0]).toMatchObject({ taskId: "math", unscheduledMinutes: 120 });
  async function editWeight(weight: string) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
    await page.getByRole("button", { name: "Edit Math", exact: true }).click();
    await page.getByLabel("Grade weight (%)").fill(weight);
    await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  }
  async function generate() {
    const response = page.waitForResponse(r => r.url().endsWith("/schedule") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
    const data = await (await response).json();
    await expect(page.locator(".info-banner")).toContainText("Your study schedule has been updated.");
    return data;
  }
  // Higher weight wins despite Math's later deadline.
  await editWeight("80");
  const result = await generate();
  expect(result.unscheduled).toEqual([expect.objectContaining({ task_id: "essay", minutes: 120 })]);
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await expect(page.locator(".assignment").filter({ hasText: "Math" })).toContainText("80% of grade");
  expect((await savedPlan(page)).warnings[0].taskId).toBe("essay");

  // Equal weights and pressure give the earlier-deadline Essay its full three hours.
  await editWeight("40");
  const tied = await generate();
  expect(tied.unscheduled).toEqual([expect.objectContaining({ task_id: "math", minutes: 120 })]);

  // A failed replan keeps the current sessions and the student's new weight.
  const previousBlocks = (await savedPlan(page)).studyBlocks;
  await page.route("**/schedule", route => route.abort());
  await editWeight("10");
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".error-banner")).toBeVisible();
  const failed = await savedPlan(page);
  expect(failed.studyBlocks).toEqual(previousBlocks);
  expect(failed.tasks.find((task: { id: string }) => task.id === "math").gradeWeight).toBe(10);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("real skip failures preserve work and history, retry and undo are safe", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("backend");
  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("Skip assignment");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-06T17:00");
  await page.getByLabel("Estimated hours").fill("2");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".study-event")).toHaveCount(2);
  await page.route("**/schedule", route => route.abort());
  await page.locator(".study-event").first().click();
  await page.getByRole("button", { name: "I Skipped", exact: true }).click();
  await expect(page.locator(".error-banner")).toBeVisible();
  await expect(page.locator(".skipped-event")).toHaveCount(1);
  await expect(page.locator(".plan-dirty")).toBeVisible();
  expect((await savedPlan(page)).tasks[0].remainingTimeMinutes).toBe(120);
  await page.unroute("**/schedule");
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  await expect(page.locator(".skipped-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo last replan" }).click();
  await expect(page.locator(".skipped-event")).toHaveCount(1);
  await expect(page.locator(".plan-dirty")).toBeVisible();
  expect((await savedPlan(page)).tasks[0].remainingTimeMinutes).toBe(120);
});

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
  await expect(page.getByRole("heading", { name: "My Schedule", exact: true })).toBeVisible();
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
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  await expect(page.locator(".info-banner")).toContainText("4 added");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await page.getByRole("button", { name: "Edit Statistics assignment" }).click();
  await page.getByLabel("Grade weight (%)").fill("25");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toBeVisible();
  await page.reload();
  await expect(page.locator(".plan-dirty")).toBeVisible();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  await expect(page.locator(".info-banner")).toContainText("0 moved, 0 added, 0 removed");
  await page.getByRole("button", { name: "Undo last replan" }).click();
  await expect(page.locator(".plan-dirty")).toBeVisible();
  expect((await savedPlan(page)).tasks[0].gradeWeight).toBe(25);
  await expect(page.locator(".study-event")).toHaveCount(4);
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);

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
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await expect(page.locator(".task-warning")).toContainText("1h still needs a time slot");
  await page.reload();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(3);
  const persisted = await savedPlan(page);
  expect(persisted.tasks[0].remainingTimeMinutes).toBe(180);
  expect(persisted.studyBlocks.filter((block: { id: string }) => history.some((old: { id: string }) => old.id === block.id))).toHaveLength(2);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  const upcoming = page.locator(".stat").filter({ hasText: "Upcoming study time" });
  await expect(upcoming).toContainText("2h");
  const shortageCard = page.locator(".stat").filter({ hasText: "Unscheduled work" });
  await expect(shortageCard).toContainText("1h");
  await page.screenshot({ path: "test-results/live-dashboard.png", fullPage: true });
});
