import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("assignment edits, persistent stale badge, backup export, validation and restore", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await page.getByLabel("Assignment name").fill("Backup assignment");
  await page.getByLabel("Deadline", { exact: true }).fill("2026-11-10T17:00");
  await page.getByLabel("Estimated hours").fill("2");
  await page.getByLabel("Grade weight (%)").fill("20");
  await page.getByRole("dialog").getByRole("button", { name: "Add assignment", exact: true }).click();
  await expect(page.locator(".plan-dirty")).toContainText("Plan needs updating");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();

  const task = page.locator(".assignment").filter({ hasText: "Backup assignment" });
  await expect(task).toContainText("20% of grade");
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await expect(page.locator(".plan-dirty")).toBeVisible();

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const download = await downloadReady;
  const text = await readFile((await download.path())!, "utf8");
  const backup = JSON.parse(text);
  expect(backup.workspace.demo.tasks.find((item: { name: string }) => item.name === "Backup assignment").gradeWeight).toBe(20);

  // Invalid files must not replace local work or open a restore confirmation.
  const beforeInvalid = await page.evaluate(() => localStorage.getItem("schedule-maker:v1"));
  await page.getByLabel("Import backup file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":99}') });
  await expect(page.locator(".error-banner")).toContainText("Invalid backup");
  expect(await page.evaluate(() => localStorage.getItem("schedule-maker:v1"))).toBe(beforeInvalid);

  await task.getByRole("button", { name: "Delete Backup assignment", exact: true }).click();
  await page.getByRole("button", { name: "Delete assignment and sessions", exact: true }).click();
  await expect(task).toHaveCount(0);
  await page.getByLabel("Import backup file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByRole("dialog")).toContainText("Restore backup?");
  await page.getByRole("button", { name: "Cancel restore" }).click();
  await expect(task).toHaveCount(0);
  await page.getByLabel("Import backup file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "Replace workspaces with backup" }).click();
  await expect(task).toContainText("20% of grade");
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Assignments/ }).click();
  await expect(task).toBeVisible();
  await expect(page.locator(".plan-dirty")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Export backup" })).toBeVisible();
  await expect(page.getByLabel("Import backup file")).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/improvements-mobile.png", fullPage: true });
});

test("skipping a session keeps work and history and undo keeps the skip report", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await expect(page.locator(".study-event").first()).toBeVisible();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).demo);
  const before = await saved();
  await page.locator(".study-event").filter({ hasText: "MATH" }).first().click();
  await page.getByRole("button", { name: "I Skipped", exact: true }).click();
  await expect(page.locator(".skipped-event")).toHaveCount(1);
  const after = await saved();
  expect(after.tasks.map((item: { remainingTimeMinutes: number }) => item.remainingTimeMinutes))
    .toEqual(before.tasks.map((item: { remainingTimeMinutes: number }) => item.remainingTimeMinutes));
  await page.getByRole("button", { name: "Undo last replan" }).click();
  await expect(page.locator(".skipped-event")).toHaveCount(1);
  await expect(page.locator(".plan-dirty")).toBeVisible();
  await page.reload();
  await expect(page.locator(".skipped-event")).toHaveCount(1);
});
