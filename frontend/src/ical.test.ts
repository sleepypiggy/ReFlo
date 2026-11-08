import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ICAL from "ical.js";
import { previewCalendar, importCalendarEvents, exportStudyCalendar } from "./lib/ical";
import { emptySchedule } from "./lib/mockData";
import { exportBackup, importBackup, initialWorkspace } from "./lib/storage";
import { Task } from "./datatypes";
import { toScheduleRequest, fromScheduleResponse } from "./lib/apiAdapter";

const calendar = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tests//EN\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const event = (properties: string, uid = "class-1") => `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Algorithms\r\n${properties.replace(/\n/g, "\r\n")}\r\nEND:VEVENT`;
const weekly = "DTSTART;TZID=America/New_York:20261026T090000\nDTEND;TZID=America/New_York:20261026T100000\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO";
const single = "DTSTART:20261110T090000Z\nDTEND:20261110T100000Z";

describe("calendar import", () => {
  it("imports a UTC single event and keeps manual events and old backups", async () => {
    const preview = await previewCalendar(calendar(event(single)));
    assert.deepEqual(preview.warnings, []);
    assert.equal(preview.events.length, 1);
    assert.equal(preview.events[0].startTime.toISOString(), "2026-11-10T09:00:00.000Z");
    assert.equal(preview.events[0].repeatOn, undefined);
    const workspace = initialWorkspace();
    const original = workspace.demo.events.length;
    workspace.demo = importCalendarEvents(workspace.demo, preview.events);
    const restored = importBackup(exportBackup(workspace));
    assert.equal(restored.demo.events.length, original + 1);
    assert.equal(restored.demo.events.at(-1)?.calendarImport?.uid, "class-1");
    assert.ok(restored.demo.events.at(-1)?.startTime instanceof Date);
    assert.equal(importBackup(exportBackup(initialWorkspace())).backend.events.length, 0);
  });
  it("keeps weekly wall times across autumn and spring DST transitions", async () => {
    const result = await previewCalendar(calendar(event(weekly)));
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.events.map(e => e.startTime.toISOString()), ["2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z", "2026-11-09T14:00:00.000Z"]);
    const spring = await previewCalendar(calendar(event(weekly.replaceAll("20261026", "20260302"))));
    assert.deepEqual(spring.events.map(e => e.startTime.toISOString()), ["2026-03-02T14:00:00.000Z", "2026-03-09T13:00:00.000Z", "2026-03-16T13:00:00.000Z"]);
  });
  it("honors inclusive UTC UNTIL, multiple weekdays, and weekly intervals", async () => {
    const result = await previewCalendar(calendar(event(weekly.replace("COUNT=3;BYDAY=MO", "UNTIL=20261102T140000Z;BYDAY=MO,WE"))));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.events.length, 3);
    assert.equal(result.events.at(-1)?.startTime.toISOString(), "2026-11-02T14:00:00.000Z");
    const interval = await previewCalendar(calendar(event(weekly.replace("COUNT=3", "COUNT=2;INTERVAL=2"))));
    assert.equal(interval.events[1].startTime.toISOString(), "2026-11-09T14:00:00.000Z");
  });
  it("applies EXDATE, cancelled and moved overrides with stable original identifiers", async () => {
    const moved = event("RECURRENCE-ID;TZID=America/New_York:20261109T090000\nDTSTART;TZID=America/New_York:20261110T110000\nDTEND;TZID=America/New_York:20261110T120000");
    const result = await previewCalendar(calendar(event(weekly + "\nEXDATE;TZID=America/New_York:20261026T090000"), event("RECURRENCE-ID;TZID=America/New_York:20261102T090000\nSTATUS:CANCELLED"), moved));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].startTime.toISOString(), "2026-11-10T16:00:00.000Z");
    assert.equal(result.events[0].calendarImport?.recurrenceId, "2026-11-09T14:00:00.000Z");
    const original = await previewCalendar(calendar(event(weekly)));
    assert.equal(original.events[2].id, result.events[0].id);
  });
  it("skips repeated identifiers across files, order, selection and backup restore", async () => {
    const preview = await previewCalendar(calendar(event(weekly)));
    const first = importCalendarEvents(emptySchedule(), [preview.events[0]]);
    const next = importCalendarEvents(first, preview.events);
    assert.equal(next.events.length, 3);
    assert.equal(next.needsReplan, true);
    assert.equal(importCalendarEvents(next, [...preview.events].reverse()).events.length, 3);
    const workspace = initialWorkspace(); workspace.backend = next;
    const restored = importBackup(exportBackup(workspace)).backend;
    assert.equal(importCalendarEvents(restored, preview.events).events.length, 3);
  });
  it("sends expanded commitments as UTC singles and rejects a scheduler response overlapping them", async () => {
    const result = await previewCalendar(calendar(event(single)));
    const schedule = importCalendarEvents(emptySchedule(), result.events);
    schedule.tasks = [new Task({ id: "assignment", name: "Essay", deadline: new Date("2026-11-11T00:00:00Z"), estimatedTimeMinutes: 60, gradeWeight: 20 })];
    const now = new Date("2026-11-10T08:00:00Z");
    const request = toScheduleRequest(schedule, now);
    assert.equal(request.events[0].start, "2026-11-10T09:00:00.000Z");
    assert.deepEqual(request.events[0].repeat_on, []);
    assert.throws(() => fromScheduleResponse({ study_blocks: [{ id: "invalid", task_id: "assignment", start: "2026-11-10T09:30:00Z", end: "2026-11-10T10:30:00Z", status: "planned" }], unscheduled: [] }, schedule, now), /fixed commitment/);
  });
  it("rejects malformed files, calendar messages and excessive file sizes", async () => {
    for (const text of ["not a calendar", calendar(event(single)).replace("END:VEVENT", ""), "x".repeat(1_000_001), calendar(event(single)).replace("VERSION:2.0", "VERSION:1.0"), calendar(event(single)).replace("VERSION:2.0", "VERSION:2.0\r\nMETHOD:CANCEL"), ...["COUNT=0", "COUNT=2;COUNT=3", "UNTIL=20260230T090000Z", "COUNT=2;INTERVAL=0"].map(rule => calendar(event(weekly.replace("COUNT=3", rule))))])
      await assert.rejects(previewCalendar(text));
  });
  it("checks IANA embedded timezone definitions instead of ignoring discrepancies", async () => {
    const timezone = `BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE`;
    const result = await previewCalendar(calendar(timezone, event(weekly)));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.events[1].startTime.toISOString(), "2026-11-02T14:00:00.000Z");
    const mismatch = await previewCalendar(calendar(timezone.replaceAll("-0500", "-0600"), event(weekly)));
    assert.equal(mismatch.events.length, 0);
    assert.ok(mismatch.warnings.length);
  });
  it("blocks unsupported or malformed series completely and explains why", async () => {
    for (const properties of [
      single.replaceAll("Z", ""), single.replace("20261110T090000Z", "20260230T090000Z"),
      weekly.replaceAll("America/New_York", "Unknown/Zone"),
      weekly.replace("FREQ=WEEKLY", "FREQ=DAILY"), weekly.replace("COUNT=3", "COUNT=999999"),
      weekly.replace(";COUNT=3", ""), weekly + ";BYHOUR=9", weekly.replace("BYDAY=MO", "BYDAY=1MO"),
      single + "\nRDATE:20261111T090000Z", single.replace("DTEND:20261110T100000Z", "DURATION:PT1H"),
      "DTSTART;VALUE=DATE:20261110\nDTEND;VALUE=DATE:20261111",
      weekly.replaceAll("20261026T09", "20261101T01").replaceAll("20261026T10", "20261101T02").replace("BYDAY=MO", "BYDAY=SU"),
      weekly.replace("COUNT=3", "COUNT=54"),
      weekly.replaceAll("20261026T09", "20260308T02").replaceAll("20261026T10", "20260308T03").replace("BYDAY=MO", "BYDAY=SU"),
      weekly + ";FOO=BAR",
      weekly + "\nEXDATE:20270101T090000Z",
    ]) {
      const result = await previewCalendar(calendar(event(properties)));
      assert.equal(result.events.length, 0, properties);
      assert.ok(result.warnings.length, properties);
    }
  });
  it("retains valid independent events but labels rejected series", async () => {
    const result = await previewCalendar(calendar(event(single), event(weekly.replace("FREQ=WEEKLY", "FREQ=MONTHLY"), "bad")));
    assert.equal(result.events.length, 1);
    assert.match(result.warnings[0], /Entire series not imported/);
  });
  it("bounds workspace imports atomically", async () => {
    const result = await previewCalendar(calendar(event(single)));
    const schedule = emptySchedule();
    schedule.events = Array.from({ length: 1000 }, (_, i) => ({ ...result.events[0], id: `manual-${i}` }));
    assert.throws(() => importCalendarEvents(schedule, result.events), /1000/);
    assert.equal(schedule.events.length, 1000);
  });
  it("bounds total source events and expanded occurrence counts", async () => {
    await assert.rejects(previewCalendar(calendar(...Array.from({ length: 1001 }, (_, i) => event(single, `event-${i}`)))), /1000/);
    const dense = weekly.replace("COUNT=3;BYDAY=MO", "COUNT=366;BYDAY=MO,TU,WE,TH,FR,SA,SU");
    const result = await previewCalendar(calendar(event(dense, "a"), event(dense, "b"), event(dense, "c")));
    assert.equal(result.events.length, 732);
    assert.ok(result.warnings.some(warning => warning.includes("1000")));
  });
});

describe("study calendar export", () => {
  it("exports valid escaped UTC events with stable UIDs and exact round-trip instants, excluding history", async () => {
    const schedule = emptySchedule();
    schedule.tasks = [new Task({ id: "task", name: "Essay, Part 1; notes\\draft\nStudy", estimatedTimeMinutes: 60, deadline: new Date("2026-12-01T00:00:00Z"), gradeWeight: 20 })];
    const planned = { id: "session-123", taskId: "task", startTime: new Date("2026-11-10T09:00:00Z"), endTime: new Date("2026-11-10T10:00:00Z"), status: "planned" as const };
    schedule.studyBlocks = [planned, ...(["completed", "unfinished", "skipped"] as const).map(status => ({ ...planned, id: status, status })), { ...planned, id: "past", startTime: new Date("2025-01-01Z"), endTime: new Date("2025-01-02Z") }];
    const now = new Date("2026-11-08T08:00:00Z");
    const text = exportStudyCalendar(schedule, now);
    const parsed = new ICAL.Component(ICAL.parse(text));
    assert.equal(parsed.getFirstPropertyValue("version"), "2.0");
    assert.ok(parsed.getFirstPropertyValue("prodid"));
    const events = parsed.getAllSubcomponents("vevent");
    assert.equal(events.length, 1);
    assert.equal(events[0].getFirstPropertyValue("uid"), "session-123@schedule-maker.local");
    assert.equal(events[0].getFirstPropertyValue("summary"), schedule.tasks[0].name);
    assert.match(text, /DTSTAMP:20261108T080000Z/);
    assert.match(text, /DTSTART:20261110T090000Z/);
    assert.match(text, /DTEND:20261110T100000Z/);
    const imported = await previewCalendar(text);
    assert.deepEqual(imported.warnings, []);
    assert.equal(imported.events[0].startTime.getTime(), planned.startTime.getTime());
    assert.equal(imported.events[0].endTime.getTime(), planned.endTime.getTime());
    assert.match(exportStudyCalendar(schedule, new Date("2026-11-09T00:00:00Z")), /UID:session-123@schedule-maker.local/);
  });
});
