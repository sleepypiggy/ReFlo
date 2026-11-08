import { test, expect, type Page } from "@playwright/test";

const id = "d0918ca3-2325-44c8-b32f-ec2badf6fbe6";
const assignment = { id, started_at: 0, kind: "assignment", title: "Math worksheet", deadline: "2026-11-10T17:00:00Z",
  estimated_minutes: 120, grade_weight: 15, start: null, end: null, sources: {} };
const ready = (draft: unknown = assignment) => ({ status: "ready", message: "Your draft is complete. Review the proposed schedule.", draft, missing_fields: [] });
const saved = (page: Page) => page.evaluate(() => {
  const plan = JSON.parse(localStorage.getItem("schedule-maker:v1")!).backend;
  // Old workspaces gain an empty topic collection when storage is revived.
  return { ...plan, topics: plan.topics ?? [] };
});
async function start(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByLabel("Data source").selectOption("backend");
  await expect(page.getByRole("log", { name: "Conversation with Flo" })).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByLabel("Message Flo").fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

// Model and scheduler requests are intercepted; backend evidence/validation tests
// separately exercise the actual chat route with mocked Gemini extraction.
test("asks for weight, restores its pending draft, previews shortages and applies exactly once", async ({ page }) => {
  await start(page);
  const before = await saved(page);
  let chats = 0, schedules = 0;
  await page.route("**/assistant/chat", async route => {
    const body = route.request().postDataJSON();
    expect(body.timezone).toBe("UTC");
    expect(body.current_time).toBe("2026-11-04T08:00:00.000Z");
    if (++chats === 1) {
      expect(body.draft).toBeNull();
      expect(body.messages).toEqual([{ role: "user", content: "Add Math worksheet due Tuesday at 5pm, two hours" }]);
      await route.fulfill({ json: { status: "needs_input", message: "Please provide the grade weight (0–100%).",
        draft: { ...assignment, grade_weight: null }, missing_fields: ["grade_weight"] } });
    } else {
      expect(body.draft.grade_weight).toBeNull();
      expect(body.messages).toHaveLength(3);
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[2]).toEqual({ role: "user", content: "15%" });
      await route.fulfill({ json: ready() });
    }
  });
  await page.route("**/schedule", async route => {
    schedules++;
    const body = route.request().postDataJSON();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ id: `assistant-${id}`, title: "Math worksheet", grade_weight: 15, remaining_minutes: 120 });
    await route.fulfill({ json: {
      study_blocks: [{ id: "study", task_id: `assistant-${id}`, start: "2026-11-04T10:00:00Z", end: "2026-11-04T11:00:00Z", status: "planned" }],
      unscheduled: [{ task_id: `assistant-${id}`, minutes: 60, reason: "Not enough time under your preferences." }],
    } });
  });
  await send(page, "Add Math worksheet due Tuesday at 5pm, two hours");
  await expect(page.getByRole("log")).toContainText("Please provide the grade weight");
  const pending = page.getByRole("region", { name: "Pending draft" });
  await expect(pending).toContainText("Not provided");
  expect(schedules).toBe(0);
  expect(await saved(page)).toEqual(before);
  await page.reload();
  await expect(page.getByRole("log")).toContainText("Math worksheet");
  await expect(pending).toContainText("Not provided");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await send(page, "15%");
  const preview = page.getByRole("region", { name: "Revised schedule preview" });
  await expect(preview).toContainText("Math worksheet");
  await expect(preview).toContainText("15% of grade");
  await expect(preview).toContainText("1 alert");
  await expect(preview.getByRole("region", { name: "Added study slots" })).toContainText("Math worksheet");
  await expect(preview.getByRole("region", { name: "Affected assignment totals" })).toContainText("60 minutes scheduled; 60 minutes unscheduled");
  expect(await saved(page)).toEqual(before);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Show assistant", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(".study-event")).toHaveCount(1);
  expect((await saved(page)).tasks).toHaveLength(1);
  await page.getByRole("button", { name: "Undo last replan" }).click();
  expect((await saved(page)).tasks).toHaveLength(1);
  expect((await saved(page)).tasks[0].name).toBe("Math worksheet");
  await expect(page.locator(".study-event")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Show assistant", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Assignment added");
  await expect(pending).toHaveCount(0);
  expect((await saved(page)).tasks).toHaveLength(1);
  expect(schedules).toBe(1);
});

test("events still preview, schedule edits invalidate previews, and cancel never changes the calendar", async ({ page }) => {
  await start(page);
  const before = await saved(page);
  const event = { ...assignment, kind: "event", title: "Work shift", deadline: null, estimated_minutes: null,
    grade_weight: null, start: "2026-11-04T19:00:00Z", end: "2026-11-04T20:00:00Z" };
  await page.route("**/assistant/chat", route => route.fulfill({ json: { ...ready(), draft: event } }));
  await page.route("**/schedule", route => route.fulfill({ json: { study_blocks: [], unscheduled: [] } }));
  await send(page, "Work tonight from 7pm to 8pm");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  expect((await saved(page)).events).toHaveLength(0);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Maximum session (minutes)").fill("60");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel draft", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Draft cancelled");
  expect((await saved(page)).events).toEqual(before.events);
  await expect(page.getByRole("region", { name: "Pending draft" })).toHaveCount(0);
});

test("provider failures, invalid ready drafts, and scheduling failures preserve the workspace and allow retry", async ({ page }) => {
  await start(page);
  const before = await saved(page);
  let response: unknown = { error: "Unavailable" };
  let status = 503, scheduleCalls = 0;
  await page.route("**/assistant/chat", route => {
    expect(route.request().postDataJSON().messages).toHaveLength(1);
    return route.fulfill({ status, json: response });
  });
  await page.route("**/schedule", route => {
    scheduleCalls++;
    return route.fulfill({ status: 500, json: { error: "Scheduling failed" } });
  });
  await send(page, "Add Math worksheet due Tuesday 5pm, two hours, 15%");
  const alert = page.getByRole("region", { name: "Flo", exact: true }).getByRole("alert");
  await expect(alert).toContainText("Assistant unavailable");
  expect(await saved(page)).toEqual(before);
  status = 200; response = ready({ ...assignment, grade_weight: null });
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(alert).toContainText("Invalid assistant");
  expect(scheduleCalls).toBe(0);
  response = ready();
  await page.getByRole("button", { name: "Retry message" }).click();
  await expect(alert).toContainText("500");
  expect(await saved(page)).toEqual(before);
  expect(scheduleCalls).toBe(1);
  await page.route("**/schedule", route => route.fulfill({ json: { study_blocks: [],
    unscheduled: [{ task_id: `assistant-${id}`, minutes: 120, reason: "No time before the deadline." }] } }));
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  expect(await saved(page)).toEqual(before);
});

test("refresh never restores an applicable preview; explicit zero percent remains valid", async ({ page }) => {
  await start(page);
  await page.route("**/assistant/chat", route => route.fulfill({ json: ready({ ...assignment, grade_weight: 0 }) }));
  await page.route("**/schedule", route => route.fulfill({ json: { study_blocks: [], unscheduled: [] } }));
  await send(page, "Add Math worksheet due Tuesday 5pm, two hours, 0%");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Pending draft" })).toContainText("0%");
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await saved(page)).tasks[0].gradeWeight).toBe(0);
});
