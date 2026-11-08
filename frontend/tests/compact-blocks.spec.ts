import { test, expect } from "@playwright/test";

test("very short event titles and boundary-height labels fit as complete lines", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  await page.addInitScript(() => {
    const lengths = [1, 5, 10, 15, 20, 25, 45, 65, 80];
    const schedule = {
      weekStart: "2026-11-09T00:00:00Z", source: "demo", tasks: [], studyBlocks: [], warnings: [],
      topics: [{ id: "topic", name: "Class topic", color: "#237854" }],
      events: lengths.map((minutes, index) => {
        const start = Date.parse("2026-11-10T09:00:00Z") + index * 90 * 60000;
        return { id: `boundary-${minutes}`, name: `Boundary ${minutes} min`, topicId: "topic",
          startTime: new Date(start).toISOString(), endTime: new Date(start + minutes * 60000).toISOString(),
          timeMinutes: minutes, remainingTimeMinutes: minutes };
      }),
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60, breakDurationMinutes: 0, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "demo", demo: schedule, backend: { ...schedule, source: "backend" } }));
  });
  await page.goto("/");
  for (const view of ["Week", "Day"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    for (const minutes of [1, 5, 10, 15, 20, 25, 45, 65, 80]) {
      const event = page.locator(`.fixed-event[title="Boundary ${minutes} min"]`);
      await expect(event).toBeVisible();
      const bounds = await event.evaluate(element => {
        const box = element.getBoundingClientRect();
        const bottom = box.bottom - parseFloat(getComputedStyle(element).borderBottomWidth);
        return [...element.querySelectorAll(".calendar-event-title, .calendar-event-time, .calendar-event-topic")]
          .filter(label => getComputedStyle(label).display !== "none")
          .map(label => ({ label: label.className, bottom: label.getBoundingClientRect().bottom, availableBottom: bottom }));
      });
      for (const bound of bounds) {
        expect(bound.bottom, `${view}: ${minutes} min ${bound.label} clips vertically`).toBeLessThanOrEqual(bound.availableBottom + 0.1);
      }
    }
  }
});

test("short adjacent blocks clip text, retain details, and stay readable across views", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-10T08:00:00Z"));
  const eventName = "Brief meeting with a very long title that must stay inside its block";
  const taskName = "Statistics revision with a very long assignment title";
  await page.addInitScript(({ eventName, taskName }) => {
    if (localStorage.getItem("schedule-maker:v1")) return;
    const schedule = {
      weekStart: "2026-11-09T00:00:00Z", source: "demo", warnings: [],
      topics: [{ id: "stats", name: "Statistics and probability", color: "#237854" }],
      tasks: [{ id: "task", name: taskName, topicId: "stats", estimatedTimeMinutes: 75, remainingTimeMinutes: 75, deadline: "2026-11-11T17:00:00Z", gradeWeight: 20 }],
      studyBlocks: [
        { id: "study", taskId: "task", startTime: "2026-11-10T10:10:00Z", endTime: "2026-11-10T10:25:00Z", status: "planned" },
        { id: "hour", taskId: "task", startTime: "2026-11-10T14:00:00Z", endTime: "2026-11-10T15:00:00Z", status: "planned" },
      ],
      events: [
        { id: "short", name: eventName, startTime: "2026-11-10T10:00:00Z", endTime: "2026-11-10T10:10:00Z", timeMinutes: 10, remainingTimeMinutes: 10 },
        { id: "long", name: "Long meeting", topicId: "stats", startTime: "2026-11-10T11:00:00Z", endTime: "2026-11-10T13:00:00Z", timeMinutes: 120, remainingTimeMinutes: 120 },
        { id: "middle", name: "Topic meeting", topicId: "stats", startTime: "2026-11-10T16:00:00Z", endTime: "2026-11-10T17:15:00Z", timeMinutes: 75, remainingTimeMinutes: 75 },
      ],
      preferences: { maxStudyTimeMinutes: 240, maxSessionTimeMinutes: 60, breakDurationMinutes: 0, sleepHours: { wakeUpTime: "07:00", bedtime: "23:00" } },
    };
    localStorage.setItem("schedule-maker:v1", JSON.stringify({ mode: "demo", demo: schedule, backend: { ...schedule, source: "backend" } }));
  }, { eventName, taskName });
  await page.goto("/");
  const meeting = page.locator('.fixed-event').filter({ hasText: eventName });
  const study = page.locator('.study-event').filter({ hasText: taskName }).first();
  const hour = page.locator('.study-event').filter({ hasText: taskName }).nth(1);
  for (const view of ["Week", "Day"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(hour.locator(".calendar-event-time")).toBeVisible();
    await expect(hour.locator(".calendar-event-time")).toContainText("2:00");
    await expect(hour.locator(".calendar-event-title")).toBeVisible();
    await expect(hour.locator(".calendar-event-topic")).toBeHidden();
    await expect(hour.locator(".calendar-event-content")).toHaveAttribute("title", /Statistics and probability/);
    for (const name of ["Long meeting", "Topic meeting"]) {
      const block = page.locator('.fixed-event').filter({ hasText: name });
      const topic = block.locator(".calendar-event-topic");
      await expect(topic).toBeVisible();
      const topicBox = (await topic.boundingBox())!;
      const blockBox = (await block.boundingBox())!;
      expect(topicBox.height).toBe(14);
      expect(topicBox.y + topicBox.height).toBeLessThanOrEqual(blockBox.y + blockBox.height - 1);
    }
    const typography = async (block: typeof hour) => block.evaluate(element => {
      const content = getComputedStyle(element.querySelector(".calendar-event-content")!);
      const title = getComputedStyle(element.querySelector(".calendar-event-title")!);
      const time = getComputedStyle(element.querySelector(".calendar-event-time")!);
      return { padding: content.padding, titleSize: title.fontSize, titleLine: title.lineHeight,
        titleWeight: title.fontWeight, timeSize: time.fontSize, timeLine: time.lineHeight,
        timeGap: time.marginBottom };
    });
    expect(await typography(hour)).toEqual(await typography(page.locator('.fixed-event').filter({ hasText: "Long meeting" })));
    const textEnd = await hour.locator(".calendar-event-title").evaluate(element => element.getBoundingClientRect().bottom);
    const hourBox = (await hour.boundingBox())!;
    expect(textEnd).toBeLessThanOrEqual(hourBox.y + hourBox.height);
    for (const block of [meeting, study]) {
      await expect(block).toBeVisible();
      await expect(block.locator(".calendar-event-time")).toBeHidden();
      expect(await block.evaluate(element => getComputedStyle(element).overflow)).toBe("hidden");
      expect(await block.locator(".calendar-event-title").evaluate(element => getComputedStyle(element).textOverflow)).toBe("ellipsis");
      const box = (await block.boundingBox())!;
      expect(box.height).toBeGreaterThan(0);
      const content = (await block.locator(".calendar-event-content").boundingBox())!;
      expect(content.y + content.height).toBeLessThanOrEqual(box.y + box.height + 1);
      await expect(block.locator(".calendar-event-content")).toHaveAttribute("title", /Nov 10/);
    }
    const meetingBox = (await meeting.boundingBox())!;
    const studyBox = (await study.boundingBox())!;
    const overlapX = Math.min(meetingBox.x + meetingBox.width, studyBox.x + studyBox.width) - Math.max(meetingBox.x, studyBox.x);
    const overlapY = Math.min(meetingBox.y + meetingBox.height, studyBox.y + studyBox.height) - Math.max(meetingBox.y, studyBox.y);
    expect(overlapX > 0.5 && overlapY > 0.5, "adjacent event and study labels must not cover each other").toBe(false);
    expect((await meeting.boundingBox())!.height).toBeLessThan((await page.locator('.fixed-event').filter({ hasText: "Long meeting" }).boundingBox())!.height);
    await page.screenshot({ path: `test-results/compact-${view.toLowerCase()}.png`, fullPage: true });
  }
  await study.click();
  await expect(page.getByRole("dialog")).toContainText(taskName);
  await expect(page.getByRole("dialog")).toContainText("15");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await meeting.click();
  await expect(page.getByLabel("Event name")).toHaveValue(eventName);
  await expect(page.getByLabel("Start datetime")).toHaveValue("2026-11-10T10:00");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(meeting).toBeVisible();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(study).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/compact-mobile.png", fullPage: true });
});
