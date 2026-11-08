import { test, expect } from "@playwright/test";

test("create, reuse, recolor, and restore a class topic on assignments and sessions", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  const assignments = () => page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Assignments/ }).click();
  await assignments();
  await page.getByRole("button", { name: "Edit CPSC 210 · Problem set 4", exact: true }).click();
  await page.getByLabel("Class / topic").selectOption("__new__");
  await page.getByLabel("Topic name").fill("CPSC 210");
  await page.getByRole("button", { name: "Purple", exact: true }).click();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.locator(".assignment.topic-purple .topic-badge")).toHaveText("CPSC 210");

  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("CPSC practice");
  await page.getByLabel("Class / topic").selectOption({ label: "CPSC 210" });
  await expect(page.getByRole("button", { name: "Purple", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-20T17:00");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
  await expect(page.locator(".assignment.topic-purple")).toHaveCount(2);

  // Updating the shared topic recolors both assignments, not just this one.
  await page.getByRole("button", { name: "Edit CPSC practice", exact: true }).click();
  await page.getByRole("button", { name: "Green", exact: true }).click();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.locator(".assignment.topic-green")).toHaveCount(2);
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.locator(".study-event.topic-study").first()).toBeVisible();
  await expect(page.locator(".study-event.topic-study .calendar-event-topic").first()).toHaveText("CPSC 210");
  await page.reload();
  await assignments();
  await expect(page.locator(".assignment.topic-green")).toHaveCount(2);

  // Removing a label from one assignment leaves the class and other links intact.
  await page.getByRole("button", { name: "Edit CPSC practice", exact: true }).click();
  await page.getByLabel("Class / topic").selectOption("");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.locator(".assignment.topic-green")).toHaveCount(1);
});

test("events support custom colors, presets, shared topics and refresh persistence", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Add Event", exact: true }).click();
  await page.getByLabel("Event name").fill("Physics lecture");
  await page.getByLabel("Class / topic").selectOption("__new__");
  await page.getByLabel("Topic name").fill("PHYS 120");
  await page.getByLabel("Choose custom color").evaluate((element) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "#12a6bd");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator(".custom-color-inputs")).toContainText("#12A6BD");
  await page.getByLabel("Start datetime").fill("2026-11-04T12:00");
  await page.getByLabel("End datetime").fill("2026-11-04T13:00");
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  const lecture = page.locator(".fixed-event").filter({ hasText: "Physics lecture" });
  await expect(lecture).toHaveCount(1);
  await expect(lecture.locator(".calendar-event-topic")).toHaveText("PHYS 120");
  expect(await lecture.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--fc-event-color"))).toContain("#12a6bd");

  await page.reload();
  await lecture.click();
  await expect(page.getByLabel("Choose custom color")).toHaveValue("#12a6bd");
  await page.getByRole("button", { name: "Gold", exact: true }).click();
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  expect(await lecture.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--fc-event-color"))).toBe("var(--assignment-bg)");

  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Class / topic").selectOption({ label: "PHYS 120" });
  await expect(page.getByRole("button", { name: "Gold", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close dialog" }).click();

  // An event can also have its own color without belonging to a class.
  await lecture.click();
  await page.getByLabel("Class / topic").selectOption("");
  await page.getByRole("button", { name: "Rose", exact: true }).click();
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await page.reload();
  await lecture.click();
  await expect(page.getByLabel("Class / topic")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Rose", exact: true })).toHaveAttribute("aria-pressed", "true");
});
