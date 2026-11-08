import { test, expect } from "@playwright/test";

test("inside dialog padding preserves edits while Escape and backdrop still close", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("button", { name: "Add Assignment", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog");
  await page.getByLabel("Assignment name").fill("Keep this draft");
  const bounds = (await dialog.boundingBox())!;
  await page.mouse.click(bounds.x + 5, bounds.y + 5);
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Assignment name")).toHaveValue("Keep this draft");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

test("tablet navigation and assignment controls fit at responsive boundaries", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: /Assignments/ }).click();
  for (const width of [320, 390, 600, 601, 640, 767, 768, 1023, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px page`).toBeLessThanOrEqual(width);
    for (const button of await navigation.getByRole("button").all()) {
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth), `${width}px navigation text`).toBe(true);
    }
    const controls = [
      ...await navigation.getByRole("button").all(),
      page.getByRole("button", { name: "Generate Schedule", exact: true }),
      page.getByRole("button", { name: "Preferences", exact: true }),
    ];
    const boxes = await Promise.all(controls.map(control => control.boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      for (const other of boxes.slice(i + 1)) {
        const box = boxes[i]!;
        const overlapX = Math.min(box.x + box.width, other!.x + other!.width) - Math.max(box.x, other!.x);
        const overlapY = Math.min(box.y + box.height, other!.y + other!.height) - Math.max(box.y, other!.y);
        expect(overlapX > 0.5 && overlapY > 0.5, `${width}px navigation overlap`).toBe(false);
      }
    }
    for (const card of await page.locator(".assignment").all()) {
      const cardBox = (await card.boundingBox())!;
      const actions = (await card.locator(".inline-actions").boundingBox())!;
      expect(actions.x, `${width}px controls left`).toBeGreaterThanOrEqual(cardBox.x);
      expect(actions.x + actions.width, `${width}px controls right`).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
    if (width === 601) await page.screenshot({ path: "test-results/ui-tablet-fixed.png", fullPage: true });
  }
});
