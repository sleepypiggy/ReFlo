import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Browser tests//EN\r\nBEGIN:VEVENT\r\nUID:biology-2026\r\nSUMMARY:Biology class\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=America/New_York:20261102T090000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test("calendar preview, selection, confirmation, duplicate import, persistence and study export", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-04T08:00:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Import calendar (.ics)" }).click();
  const dialog = page.getByRole("dialog");
  await page.getByLabel("Calendar file (.ics)").setInputFiles({ name: "classes.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  await expect(dialog).toContainText("2 new occurrences");
  await expect(dialog).toContainText("America/New_York");
  await expect(dialog).toContainText("2026-11-09T14:00:00.000Z");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const savedEvents = () => page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).demo.events);
  const before = (await savedEvents()).length;
  const choices = dialog.getByRole("checkbox", { name: /Biology class/ });
  await choices.first().uncheck();
  await dialog.getByRole("button", { name: "Import 1 selected commitments" }).click();
  await expect(dialog).toContainText("Imported 1 commitments. Generate Schedule");
  expect((await savedEvents()).length).toBe(before + 1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Plan needs updating.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Import calendar (.ics)" }).click();
  await page.getByLabel("Calendar file (.ics)").setInputFiles({ name: "again.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  await expect(dialog).toContainText("1 new occurrences; 1 already imported");
  await dialog.getByRole("button", { name: "Import 1 selected commitments" }).click();
  expect((await savedEvents()).length).toBe(before + 2);
  await expect(dialog.getByRole("button", { name: "Import 0 selected commitments" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText(/Calendar files are snapshots/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export study calendar" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("schedule-maker-study.ics");
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("BEGIN:VCALENDAR\r\n");
  expect(text).toContain("VERSION:2.0");
  expect(text).toContain("PRODID:-//Schedule Maker//Study planner//EN");
  const blocks = await page.evaluate(() => JSON.parse(localStorage.getItem("schedule-maker:v1")!).demo.studyBlocks);
  const planned = blocks.filter((block: { status: string; endTime: string }) => block.status === "planned" && new Date(block.endTime) > new Date("2026-11-04T08:00:00Z"));
  expect(text.match(/BEGIN:VEVENT/g)?.length).toBe(planned.length);
  for (const block of planned) {
    expect(text).toContain(`UID:${block.id}@schedule-maker.local`);
    expect(text).toContain(`DTSTART:${block.startTime.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`);
  }
  await page.getByRole("button", { name: "Import calendar (.ics)" }).click();
  await page.getByLabel("Calendar file (.ics)").setInputFiles({ name: "study.ics", mimeType: "text/calendar", buffer: Buffer.from(text) });
  await expect(dialog).toContainText(`${planned.length} new occurrences`);
});

test("invalid calendar and unsupported recurrence leave data untouched", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Import calendar (.ics)" }).click();
  const upload = page.getByLabel("Calendar file (.ics)");
  await upload.setInputFiles({ name: "bad.ics", mimeType: "text/calendar", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Invalid iCalendar");
  await upload.setInputFiles({ name: "unsupported.ics", mimeType: "text/calendar", buffer: Buffer.from(ics.replace("FREQ=WEEKLY", "FREQ=MONTHLY")) });
  await expect(page.getByRole("dialog")).toContainText("Only weekly recurrence is supported");
  await expect(page.getByRole("dialog")).toContainText("No supported events found");
  await expect(page.getByRole("button", { name: "Import 0 selected commitments" })).toBeDisabled();
});
