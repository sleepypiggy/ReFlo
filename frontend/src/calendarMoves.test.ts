import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type StudyBlock, type Schedule } from "./datatypes";
import { moveCalendarItem, canMoveStudy } from "./lib/calendarMoves";
import { expandEvents, isPreserved } from "./lib/calendar";
import { toScheduleRequest, fromScheduleResponse } from "./lib/apiAdapter";
import { emptySchedule, demoResult } from "./lib/mockData";
import { initialWorkspace, exportBackup, importBackup } from "./lib/storage";

// Local wall times keep these tests independent of the machine's timezone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const now = at(10, 8);
const session = (id = "study", day = 10, hour = 10): StudyBlock => ({
  id, taskId: "task", startTime: at(day, hour), endTime: at(day, hour + 1), status: "planned",
});
function plan(): Schedule {
  return { ...emptySchedule(), tasks: [new Task({ id: "task", name: "Essay", estimatedTimeMinutes: 180,
    remainingTimeMinutes: 150, deadline: at(13, 17), gradeWeight: 20 })], studyBlocks: [session()] };
}
const move = (schedule: Schedule, startTime = at(11, 14)) =>
  moveCalendarItem(schedule, { type: "study", id: "study", startTime }, now);
function rejected(schedule: Schedule, startTime: Date, reason: RegExp) {
  const before = JSON.stringify(schedule);
  assert.match(move(schedule, startTime).error ?? "", reason);
  assert.equal(JSON.stringify(schedule), before);
}

describe("calendar study moves", () => {
  it("moves day/time without altering duration, deadlines, work, status or warnings", () => {
    const before = plan();
    const result = move(before);
    assert.ok(result.schedule);
    const after = result.schedule;
    assert.equal(after.tasks, before.tasks);
    assert.equal(after.warnings, before.warnings);
    assert.equal(after.events, before.events);
    assert.equal(+after.studyBlocks[0].startTime, +at(11, 14));
    assert.equal(+after.studyBlocks[0].endTime, +at(11, 15));
    assert.equal(after.studyBlocks[0].status, "planned");
    assert.equal(after.studyBlocks[0].locked, undefined);
    assert.equal(after.studyBlocks[0].manuallyMoved, true);
    assert.equal(+before.studyBlocks[0].startTime, +at(10, 10));
    assert.ok(move(after, at(12, 14)).schedule, "manual placements can be moved again");
  });
  it("rejects past, started, locked and every finalized status", () => {
    for (const block of [session("study", 9), { ...session(), startTime: now },
      { ...session(), locked: true }, ...(["completed", "unfinished", "skipped"] as const).map(status => ({ ...session(), status }))]) {
      assert.equal(canMoveStudy(block, now), false);
      rejected({ ...plan(), studyBlocks: [block] }, at(11, 14), /Past, started, or finalized/);
    }
    rejected(plan(), now, /future/);
    rejected(plan(), at(9, 14), /future/);
    rejected(plan(), new Date(NaN), /valid date/);
  });
  it("enforces deadlines and both study limits at their boundaries", () => {
    assert.ok(move(plan(), at(13, 16)).schedule);
    rejected(plan(), at(13, 16, 1), /deadline/);
    const length = plan(); length.preferences.maxSessionTimeMinutes = 59;
    rejected(length, at(11, 14), /session length/);
    const daily = plan(); daily.preferences.maxStudyTimeMinutes = 119;
    daily.studyBlocks.push(session("other", 11, 10));
    rejected(daily, at(11, 14), /daily study limit/);
    daily.preferences.maxStudyTimeMinutes = 120;
    assert.ok(move(daily).schedule);
  });
  it("checks sleep hours, including overnight waking hours and midnight crossings", () => {
    rejected(plan(), at(11, 6, 30), /sleep/);
    rejected(plan(), at(11, 22, 30), /sleep/);
    assert.ok(move(plan(), at(11, 7)).schedule);
    const night = plan(); night.preferences.sleepHours = { bedtime: "07:00", wakeUpTime: "20:00" };
    rejected(night, at(11, 12), /sleep/);
    assert.ok(move(night, at(11, 23, 30)).schedule);
    rejected(night, at(11, 6, 30), /sleep/);
    night.preferences.maxStudyTimeMinutes = 60;
    night.studyBlocks.push(session("other", 12, 1));
    rejected(night, at(11, 23, 30), /daily study limit/);
  });
  it("rejects commitments, overlaps and insufficient breaks, accepting exact boundaries", () => {
    const value = plan();
    value.events = [{ id: "class", name: "Class", startTime: at(10, 14), endTime: at(10, 15),
      timeMinutes: 60, remainingTimeMinutes: 60, repeatOn: [3] }];
    rejected(value, at(11, 14), /fixed commitment/);
    value.events = [];
    value.studyBlocks.push(session("other", 11, 13));
    rejected(value, at(11, 13, 30), /another study session/);
    rejected(value, at(11, 14), /15 minutes/);
    assert.ok(move(value, at(11, 14, 15)).schedule);
    rejected(value, at(11, 12), /15 minutes/);
    assert.ok(move(value, at(11, 11, 45)).schedule);
  });
  it("persists manual placements and reserves them in real and demo regeneration", () => {
    const moved = move(plan()).schedule!;
    const workspace = initialWorkspace(); workspace.backend = moved;
    const restored = importBackup(exportBackup(workspace)).backend;
    assert.equal(restored.studyBlocks[0].manuallyMoved, true);
    assert.ok(isPreserved(restored.studyBlocks[0], now));
    const request = toScheduleRequest(restored, now);
    assert.equal(request.locked_blocks.length, 1);
    assert.equal(request.tasks[0].remaining_minutes, 150);
    assert.equal(request.locked_blocks[0].start, at(11, 14).toISOString());
    assert.deepEqual(fromScheduleResponse({ study_blocks: [], unscheduled: [] }, restored, now).studyBlocks, restored.studyBlocks);
    assert.equal(demoResult(restored, now).warnings[0].unscheduledMinutes, 90);
    assert.throws(() => fromScheduleResponse({ study_blocks: [{ id: "overlap", task_id: "task",
      start: at(11, 14).toISOString(), end: at(11, 15).toISOString(), status: "planned" }], unscheduled: [] }, restored, now), /overlapping/);
  });
});

describe("fixed commitment moves", () => {
  it("moves one occurrence, persists the exception and sends it to the scheduler", () => {
    const value = plan();
    value.events = [{ id: "class", name: "Class", startTime: at(10, 9), endTime: at(10, 10),
      timeMinutes: 60, remainingTimeMinutes: 60, repeatOn: [2] }];
    const result = moveCalendarItem(value, { type: "fixed", id: "class", occurrenceStart: at(17, 9), startTime: at(18, 13) }, now);
    assert.ok(result.schedule);
    assert.equal(result.schedule.needsReplan, true);
    assert.equal(result.schedule.tasks, value.tasks);
    assert.equal(result.schedule.studyBlocks, value.studyBlocks);
    assert.equal(result.schedule.events.length, 2);
    const workspace = initialWorkspace(); workspace.backend = result.schedule;
    const restored = importBackup(exportBackup(workspace)).backend;
    const occurrences = expandEvents(restored.events, at(10, 0), at(25, 0));
    assert.deepEqual(occurrences.map(event => +event.startTime).sort(), [at(10, 9), at(18, 13), at(24, 9)].map(Number).sort());
    assert.deepEqual(toScheduleRequest(restored, now).events[0].exclude_starts, [at(17, 9).toISOString()]);
    const again = moveCalendarItem(restored, { type: "fixed", id: restored.events[1].id, occurrenceStart: at(18, 13), startTime: at(19, 13) }, now);
    assert.equal(again.schedule?.events.length, 2);
    assert.equal(+again.schedule!.events[1].endTime, +at(19, 14));
    assert.equal(moveCalendarItem(restored, { type: "fixed", id: "class", occurrenceStart: at(17, 9), startTime: at(19, 13) }, now).schedule, undefined);
  });
});
