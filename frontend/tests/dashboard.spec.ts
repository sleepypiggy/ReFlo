import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "My Schedule" }),
  ).toBeVisible();
  await expect(page.locator(".calendar-event").first()).toBeVisible();
}
async function addTask(page: Page, name = "Test assignment") {
  await page
    .getByRole("button", { name: "Add Assignment", exact: true })
    .click();
  await page.getByLabel("Assignment name").fill(name);
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-20T17:00");
  await page.getByLabel("Estimated hours").fill("2.5");
  await page.getByLabel("Grade weight (%)").fill("20");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add assignment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("assignment, event and preferences forms persist across refresh", async ({
  page,
}) => {
  await start(page);
  await addTask(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  const task = page.locator(".assignment").filter({
    has: page.getByRole("heading", { name: "Test assignment", exact: true }),
  });
  await expect(task).toContainText("2.5h remaining");
  await task.getByRole("button", { name: "Edit Test assignment" }).click();
  await page.getByLabel("Assignment name").fill("Edited assignment");
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("button", { name: "Add Event", exact: true }).click();
  await page.getByLabel("Event name").fill("Campus shift");
  await page.getByLabel("Start datetime").fill("2026-11-04T15:00");
  await page.getByLabel("End datetime").fill("2026-11-04T14:00");
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await expect(page.locator(".error, .error-banner")).toContainText(
    "end time after",
  );
  await page.getByLabel("End datetime").fill("2026-11-04T16:00");
  await page.getByLabel("Wed", { exact: true }).check();
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.locator(".calendar-event").filter({ hasText: "Campus shift" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Wake-up time").fill("06:30");
  await page.getByLabel("Bedtime", { exact: true }).fill("22:30");
  await page.getByLabel("Maximum daily study (hours)").fill("5");
  await page.getByLabel("Maximum session (minutes)").fill("75");
  await page.getByLabel("Break duration (minutes)").fill("20");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edited assignment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.locator(".calendar-event").filter({ hasText: "Campus shift" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByLabel("Maximum session (minutes)")).toHaveValue("75");
  await expect(page.getByLabel("Wake-up time")).toHaveValue("06:30");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await page
    .getByRole("button", { name: "Delete Edited assignment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete assignment and sessions" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edited assignment" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Next period" }).click();
  await page
    .locator(".fixed-event")
    .filter({ hasText: "Campus shift" })
    .click();
  await page.getByLabel("Event name").fill("Updated campus shift");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await page
    .locator(".fixed-event")
    .filter({ hasText: "Updated campus shift" })
    .click();
  await page
    .getByRole("button", { name: "Delete commitment", exact: true })
    .click();
  await expect(
    page.locator(".fixed-event").filter({ hasText: "campus shift" }),
  ).toHaveCount(0);
});

test("demo sessions complete once and unfinished reports preserve history", async ({
  page,
}) => {
  await start(page);
  await expect(page.locator(".fixed-event").first()).toBeVisible();
  await expect(page.locator(".completed-event")).toHaveCount(1);
  await page
    .locator(".study-event")
    .filter({ hasText: "MATH" })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Mark Complete", exact: true })
    .click();
  await expect(page.locator(".completed-event")).toHaveCount(2);
  await page.locator(".completed-event").filter({ hasText: "MATH" }).click();
  await expect(
    page.getByRole("button", { name: "Mark Complete", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".study-event")
    .filter({ hasText: "CPSC" })
    .first()
    .click();
  await page
    .getByRole("button", { name: "I Didn't Finish", exact: true })
    .click();
  await page
    .getByLabel("Total assignment work remaining (minutes)")
    .fill("180");
  await page
    .getByRole("button", { name: "Save remaining & reschedule" })
    .click();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".completed-event")).toHaveCount(2);
  await expect(page.locator(".info-banner")).toContainText("Mock timetable");
  await page.reload();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".completed-event")).toHaveCount(2);
});

test("backend generation serializes data, preserves blocks on errors, and locks unfinished history", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Data source").selectOption("backend");
  await expect(page.locator(".calendar-event")).toHaveCount(0);
  await addTask(page, "Backend assignment");
  let responseMode: "success" | "failure" | "malformed" | "network" | "validation" = "success";
  let calls = 0;
  await page.route("http://localhost:8000/schedule", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.contract_version).toBe(1);
    expect(body.tasks[0].title).toBe("Backend assignment");
    expect(body.tasks[0].estimated_minutes).toBe(150);
    expect(body.tasks[0].deadline).toMatch(/Z$/);
    expect(body.current_time).toMatch(/Z$/);
    expect(body.preferences.max_session_minutes).toBe(90);
    if (responseMode === "network") {
      await route.abort("failed");
      return;
    }
    if (responseMode === "failure") {
      await route.fulfill({ status: 404, json: { detail: "Not found" } });
      return;
    }
    if (responseMode === "validation") {
      await route.fulfill({ status: 400, json: {
        error: "Extra inputs are not permitted",
        details: [{ loc: ["body", "preferences", "spread_assignments"], msg: "Extra inputs are not permitted", type: "extra_forbidden" }],
      } });
      return;
    }
    if (responseMode === "malformed") {
      await route.fulfill({
        json: {
          study_blocks: [{ id: "bad", task_id: "unknown" }],
          unscheduled: [],
        },
      });
      return;
    }
    if (calls > 0) {
      expect(body.locked_blocks).toHaveLength(1);
      expect(body.locked_blocks[0].status).toBe("unfinished");
      expect(body.tasks[0].remaining_minutes).toBe(120);
    }
    calls++;
    const start = new Date(Date.parse(body.current_time) + calls * 7200000);
    const end = new Date(+start + 3600000);
    await route.fulfill({
      json: {
        study_blocks: [
          {
            id: `response-${calls}`,
            task_id: body.tasks[0].id,
            start: start.toISOString(),
            end: end.toISOString(),
            status: "planned",
          },
        ],
        unscheduled: [
          {
            task_id: body.tasks[0].id,
            minutes: calls === 1 ? 90 : 60,
            reason: "Limited availability",
          },
        ],
      },
    });
  });
  await page
    .getByRole("button", { name: "Generate Schedule", exact: true })
    .click();
  await expect(page.locator(".study-event")).toHaveCount(1);
  responseMode = "failure";
  await page
    .getByRole("button", { name: "Generate Schedule", exact: true })
    .click();
  await expect(page.locator(".error, .error-banner")).toContainText(
    "not implemented",
  );
  await expect(page.locator(".study-event")).toHaveCount(1);
  responseMode = "validation";
  await page.getByRole("button", { name: "Generate Schedule", exact: true }).click();
  await expect(page.locator(".error-banner")).toContainText("preferences.spread_assignments");
  await expect(page.locator(".error-banner")).toContainText("Restart the Python backend");
  await expect(page.locator(".study-event")).toHaveCount(1);
  responseMode = "malformed";
  await page
    .getByRole("button", { name: "Generate Schedule", exact: true })
    .click();
  await expect(page.locator(".error, .error-banner")).toContainText(
    "invalid task",
  );
  await expect(page.locator(".study-event")).toHaveCount(1);
  responseMode = "network";
  await page
    .getByRole("button", { name: "Generate Schedule", exact: true })
    .click();
  await expect(page.locator(".error-banner")).toContainText("Cannot reach");
  await expect(page.locator(".study-event")).toHaveCount(1);
  responseMode = "failure";
  await page.locator(".study-event").click();
  await page
    .getByRole("button", { name: "I Didn't Finish", exact: true })
    .click();
  await page
    .getByLabel("Total assignment work remaining (minutes)")
    .fill("120");
  await page
    .getByRole("button", { name: "Save remaining & reschedule" })
    .click();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".error-banner")).toContainText("not implemented");
  await expect(page.locator(".study-event")).toHaveCount(0);
  responseMode = "success";
  await page
    .getByRole("button", { name: "Generate Schedule", exact: true })
    .click();
  await expect(page.locator(".unfinished-event")).toHaveCount(1);
  await expect(page.locator(".study-event")).toHaveCount(1);
  await page.getByLabel("Data source").selectOption("demo");
  await expect(
    page.getByRole("heading", { name: "Backend assignment" }),
  ).toHaveCount(0);
  await expect(page.locator(".completed-event")).toHaveCount(1);
});

test("month/week/day navigation and responsive layout", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.locator(".calendar-dayGridMonth")).toBeVisible();
  await expect(page.getByRole("button", { name: "Month", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/month-view.png", fullPage: true });
  await page.locator(".calendar-dayGridMonth .study-event").filter({ hasText: "MATH" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const monthTitle = await page.locator(".calendar-date h2").innerText();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(page.locator(".calendar-date h2")).not.toHaveText(monthTitle);
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(page.locator(".calendar-date h2")).toHaveText(monthTitle);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.locator(".calendar-timeGridDay")).toBeVisible();
  await page.getByRole("button", { name: "Next period" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
