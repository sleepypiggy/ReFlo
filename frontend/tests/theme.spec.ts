import { test, expect } from "@playwright/test";

test("theme toggles and persists without changing schedule data", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible();
  const add = await page.getByRole("button", { name: "Add Assignment", exact: true }).boundingBox();
  const heading = await page.getByRole("heading", { name: "My Schedule" }).boundingBox();
  const calendar = await page.getByRole("region", { name: "Study calendar" }).boundingBox();
  expect(add!.x).toBeGreaterThan(heading!.x);
  expect(Math.abs(add!.y - heading!.y)).toBeLessThan(30);
  expect(calendar!.width).toBeGreaterThan(900);
  await expect(page.locator(".assignment-panel")).toHaveCount(0);
  await expect(page.locator(".stats-grid")).toHaveCount(0);
  await expect(page.locator(".workspace-label")).toHaveCount(0);
  await page.getByRole("button", { name: "Assignments", exact: false }).first().click();
  await expect(page.locator(".assignment-panel")).toBeVisible();
  await expect(page.locator(".stats-grid")).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  // Finish saved-workspace schema migration before comparing theme-only changes.
  await page.reload();
  await expect(page.getByRole("heading", { name: "My Schedule" })).toBeVisible();
  await page.waitForFunction(() => localStorage.getItem("schedule-maker:v1"));
  const workspace = await page.evaluate(() => localStorage.getItem("schedule-maker:v1"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(21, 23, 25)");
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("schedule-maker:v1"))).toBe(workspace);

  await page.getByRole("button", { name: "Add Assignment", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgb(38, 42, 46)");
  await expect(page.getByLabel("Assignment name")).toHaveCSS("color", "rgb(240, 238, 233)");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({ path: "test-results/design-dark.png", fullPage: true });

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 241, 236)");
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("schedule-maker:v1"))).toBe(workspace);
  await page.screenshot({ path: "test-results/design-light.png", fullPage: true });
});

test("system preference provides the default and saved choice overrides it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("theme is usable with unavailable browser storage and narrow layouts", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/design-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
