import { test, expect, type Page } from "@playwright/test";

test.describe("calendar files with the scheduler", () => {
  test.use({ timezoneId: "UTC" });
  test("calendar import reserves commitments before real scheduling and export", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
    await page.addInitScript(() => {
      const schedule = { weekStart: "2026-11-09T00:00:00Z", source: "backend", tasks: [{ id: "essay", name: "Calendar integration essay", estimatedTimeMinutes: 120, remainingTimeMinutes: 120, deadline: "2026-11-10T12:00:00Z", gradeWeight: 20 }], events: [], studyBlocks: [], warnings: [], preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60, breakDurationMinutes: 0, sleepHours: { wakeUpTime: "09:00", bedtime: "12:00" } } };
      if (!localStorage.getItem("schedule-maker:v1")) localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "backend", backend: schedule, demo: { ...schedule, source: "demo" } }));
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
    await expect(page.locator(".study-event")).toHaveCount(2);
    await page.getByRole("button", { name: "Import calendar (.ics)" }).click();
    await page.getByLabel("Calendar file (.ics)").setInputFiles({ name: "class.ics", mimeType: "text/calendar", buffer: Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:integration-class\r\nSUMMARY:Imported lecture\r\nDTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n") });
    await expect(page.getByRole("dialog")).toContainText("2 new occurrences");
    const response = page.waitForResponse(r => r.url().endsWith("/schedule") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Import 2 selected commitments" }).click();
    await expect(page.getByRole("dialog")).toContainText("Imported 2 commitments");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const result = await (await response).json();
    expect(result.unscheduled).toEqual([]);
    expect(result.study_blocks.map((block: { start: string }) => block.start)).toEqual(["2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"]);
    await expect(page.getByText("Plan needs updating.")).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export study calendar" }).click();
    expect((await download).suggestedFilename()).toBe("schedule-maker-study.ics");
  });
});

// Real browser requests go through CORS to a separate FastAPI process. No API
// scheduling routes are intercepted. Only the assistant model output is stubbed
// in the preview step. Fixed commitments leave exactly the prototype windows.
async function savedPlan(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend);
}

test.describe("fixed event impact preview", () => {
  test.use({ timezoneId: "UTC" });
  test("partial fit shows removed and added slots and commits only after Apply", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-10T19:00:00Z"));
    await page.addInitScript(() => {
      if (localStorage.getItem("schedule-maker:v1")) return;
      const plan = {
        weekStart: "2026-11-09T00:00:00Z", source: "backend",
        tasks: [{ id: "stats", name: "Statistics", estimatedTimeMinutes: 30,
          remainingTimeMinutes: 30, deadline: "2026-11-10T20:15:00Z", gradeWeight: 20 }],
        events: [], warnings: [],
        studyBlocks: [{ id: "original-slot", taskId: "stats", startTime: "2026-11-10T19:30:00Z",
          endTime: "2026-11-10T20:00:00Z", status: "planned" }],
        preferences: { maxStudyTimeMinutes: 120, maxSessionTimeMinutes: 60,
          breakDurationMinutes: 15, spreadAssignments: false,
          sleepHours: { wakeUpTime: "19:00", bedtime: "22:00" } },
      };
      localStorage.setItem("schedule-maker:v1", JSON.stringify({
        mode: "backend", backend: plan, demo: { ...plan, source: "demo" },
      }));
    });
    const shift = { type: "event_draft", title: "Work shift",
      start: "2026-11-10T19:00:00Z", end: "2026-11-10T20:00:00Z" };
    await page.route("**/assistant/chat", route => route.fulfill({ json: {
      status: "ready", message: "Review your event draft.", missing_fields: [],
      draft: { id: "a0518ca3-2325-44c8-b32f-ec2badf6fbe6", started_at: 0, kind: "event",
        title: shift.title, start: shift.start, end: shift.end, deadline: null,
        estimated_minutes: null, grade_weight: null, sources: {} },
    } }));
    await page.goto("/");
    await expect(page.locator(".study-event")).toHaveCount(1);
    const before = await savedPlan(page);
    const prepare = async () => {
      await page.getByLabel("Assistant message").fill("I have work from 7 to 8 tonight");
      const response = page.waitForResponse(r => r.url().endsWith("/schedule") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(200);
      const request = result.request().postDataJSON();
      expect(request.events[0].start).toBe(shift.start.replace("Z", ".000Z"));
      expect(request.events[0].end).toBe(shift.end.replace("Z", ".000Z"));
      expect(request.tasks[0].remaining_minutes).toBe(30);
      const data = await result.json();
      expect(data.study_blocks).toHaveLength(1);
      expect(data.study_blocks[0].start).toBe("2026-11-10T20:00:00Z");
      expect(data.study_blocks[0].end).toBe("2026-11-10T20:15:00Z");
      expect(data.unscheduled).toEqual([expect.objectContaining({ task_id: "stats", minutes: 15 })]);
      const preview = page.getByRole("region", { name: "Revised schedule preview" });
      await expect(preview).toContainText("Work shift");
      await expect(preview).toContainText(/7:00\s*p\.?m\.?/i);
      await expect(preview).toContainText(/8:00\s*p\.?m\.?/i);
      await expect(preview.getByRole("region", { name: "Removed study slots" })).toContainText(/7:30\s*p\.?m\.?/i);
      await expect(preview.getByRole("region", { name: "Removed study slots" })).toContainText(/8:00\s*p\.?m\.?/i);
      await expect(preview.getByRole("region", { name: "Added study slots" })).toContainText(/8:00\s*p\.?m\.?/i);
      await expect(preview.getByRole("region", { name: "Added study slots" })).toContainText(/8:15\s*p\.?m\.?/i);
      await expect(preview.getByRole("region", { name: "Affected assignment totals" }))
        .toContainText("Statistics: 15 minutes scheduled; 15 minutes unscheduled before the deadline.");
      expect(await savedPlan(page)).toEqual(before);
      await expect(page.locator(".fixed-event")).toHaveCount(0);
      await expect(page.locator(".study-event")).toHaveCount(1);
      return preview;
    };
    let preview = await prepare();
    await preview.getByRole("button", { name: "Discard preview" }).click();
    expect(await savedPlan(page)).toEqual(before);
    await expect(page.locator(".fixed-event")).toHaveCount(0);
    preview = await prepare();
    await preview.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(preview).toHaveCount(0);
    const review = page.getByRole("region", { name: "Latest schedule changes" });
    await expect(review).toContainText("1 moved, 0 added, 0 removed");
    await expect(review).toContainText("15 minutes unscheduled");
    await expect(review).toContainText("Previous:");
    await expect(review).toContainText("Now:");
    await expect(page.locator(".changed-study-event")).toHaveCount(1);
    await expect(page.locator(".fixed-event")).toHaveCount(1);
    await expect.poll(async () => (await savedPlan(page)).events.length).toBe(1);
    const applied = await savedPlan(page);
    expect(applied.events[0].startTime).toBe("2026-11-10T19:00:00.000Z");
    expect(applied.events[0].endTime).toBe("2026-11-10T20:00:00.000Z");
    expect(applied.studyBlocks).toEqual([expect.objectContaining({
      taskId: "stats", startTime: "2026-11-10T20:00:00.000Z", endTime: "2026-11-10T20:15:00.000Z",
    })]);
    expect(applied.warnings[0].unscheduledMinutes).toBe(15);
    await page.reload();
    await expect(page.locator(".fixed-event")).toHaveCount(1);
    expect((await savedPlan(page)).studyBlocks).toEqual(applied.studyBlocks);
  });
});

test("spacing preference distributes real study work and can restore earliest packing", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("backend");
  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("Spaced assignment");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-13T17:00");
  await page.getByLabel("Estimated hours").fill("4");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByLabel("Spread study sessions across days")).toBeChecked();
  await page.getByLabel("Wake-up time").fill("09:00");
  await page.getByLabel("Bedtime", { exact: true }).fill("17:00");
  await page.getByLabel("Maximum session (minutes)").fill("60");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".study-event")).toHaveCount(4);
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  const spread = await savedPlan(page);
  expect(new Set(spread.studyBlocks.map((block: { startTime: string }) => block.startTime.slice(0, 10))).size).toBe(4);
  expect(spread.warnings).toEqual([]);

  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Spread study sessions across days").uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByLabel("Spread study sessions across days")).not.toBeChecked();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  const packed = await savedPlan(page);
  expect(packed.studyBlocks).toHaveLength(4);
  expect(new Set(packed.studyBlocks.map((block: { startTime: string }) => block.startTime.slice(0, 10))).size).toBe(1);

  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Spread study sessions across days").check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  expect((await savedPlan(page)).studyBlocks).toEqual(spread.studyBlocks);
  await page.screenshot({ path: "test-results/spread-schedule.png", fullPage: true });
});

test("real study sessions use morning afternoon and evening around conflicts", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("backend");
  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("Daytime variety");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-10T22:00");
  await page.getByLabel("Estimated hours").fill("3");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Wake-up time").fill("09:00");
  await page.getByLabel("Bedtime", { exact: true }).fill("22:00");
  await page.getByLabel("Maximum session (minutes)").fill("60");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".study-event")).toHaveCount(3);
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  const hours = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend.studyBlocks
    .map((block: { startTime: string }) => new Date(block.startTime).getHours()));
  expect(await hours()).toEqual([9, 12, 17]);

  await page.getByRole("button", { name: "Add Event", exact: true }).click();
  await page.getByLabel("Event name").fill("Lunch meeting");
  await page.getByLabel("Start datetime").fill("2026-11-10T12:00");
  await page.getByLabel("End datetime").fill("2026-11-10T13:00");
  const automatic = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  expect((await (await automatic).json()).unscheduled).toEqual([]);
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  expect(await hours()).toEqual([9, 13, 17]);
  expect((await savedPlan(page)).warnings).toEqual([]);
  const meeting = (await savedPlan(page)).events.find((event: { name: string }) => event.name === "Lunch meeting");
  const chosen = await page.evaluate(() => [new Date("2026-11-10T12:00").getTime(), new Date("2026-11-10T13:00").getTime()]);
  expect([new Date(meeting.startTime).getTime(), new Date(meeting.endTime).getTime()]).toEqual(chosen);
  await page.locator(".fixed-event").filter({ hasText: "Lunch meeting" }).first().click();
  await page.getByLabel("Start datetime").fill("2026-11-10T17:00");
  await page.getByLabel("End datetime").fill("2026-11-10T18:00");
  const edited = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  expect((await (await edited).json()).unscheduled).toEqual([]);
  await expect(page.locator(".plan-dirty")).toHaveCount(0);
  expect(await hours()).toEqual([9, 12, 18]);
  await page.screenshot({ path: "test-results/daypart-schedule.png", fullPage: true });
});

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
        breakDurationMinutes: 0, spreadAssignments: false, sleepHours: { wakeUpTime: "09:00", bedtime: "14:00" } },
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
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Spread study sessions across days").uncheck();
  await page.getByRole("button", { name: "Save preferences" }).click();
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
        breakDurationMinutes: 15, spreadAssignments: false, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
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

  const beforePreview = await savedPlan(page);
  const shift = await page.evaluate(() => ({
    type: "event_draft", title: "Thursday work shift",
    start: new Date("2026-11-12T18:15").toISOString(),
    end: new Date("2026-11-12T19:15").toISOString(),
  }));
  await page.route("**/assistant/chat", route => route.fulfill({ json: {
    status: "ready", message: "Review your event draft.", missing_fields: [],
    draft: { id: "d0918ca3-2325-44c8-b32f-ec2badf6fbe6", started_at: 0, kind: "event",
      title: shift.title, start: shift.start, end: shift.end, deadline: null,
      estimated_minutes: null, grade_weight: null, sources: {} },
  } }));
  await page.getByLabel("Assistant message").fill("I work Thursday from 6:15 to 7:15 pm");
  const shortageResponse = page.waitForResponse(response => response.url().endsWith("/schedule") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const shortage = await (await shortageResponse).json();
  expect(shortage.study_blocks).toHaveLength(2);
  expect(shortage.unscheduled[0].minutes).toBe(60);
  const preview = page.getByRole("region", { name: "Revised schedule preview" });
  await expect(preview).toContainText("Thursday work shift");
  await expect(preview).toContainText("1 alert");
  expect(await savedPlan(page)).toEqual(beforePreview);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(preview).toHaveCount(0);
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
