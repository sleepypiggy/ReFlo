import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type StudyBlock } from "./datatypes";
import { initialWorkspace } from "./lib/storage";
import { studyAdvice } from "./lib/studyAdvice";

const at = (time: string) => new Date(`2026-11-10T${time}:00Z`);
const now = at("06:00");
const block = (start: string, status: StudyBlock["status"] = "planned"): StudyBlock => ({
  id: start + status, taskId: "stats", status, startTime: at(start), endTime: new Date(+at(start) + 30 * 60000),
});
function plan() {
  const result = initialWorkspace().backend;
  result.tasks = [new Task({ id: "stats", name: "Statistics", estimatedTimeMinutes: 60,
    deadline: at("12:00"), gradeWeight: 20 })];
  result.studyBlocks = [block("08:00"), block("07:00")];
  return result;
}

describe("read-only study advice", () => {
  it("selects the earliest active planned session, ignoring history, started sessions and inactive tasks", () => {
    const schedule = plan();
    schedule.tasks.push(new Task({ id: "done", name: "Done", estimatedTimeMinutes: 30,
      remainingTimeMinutes: 0, deadline: at("12:00"), gradeWeight: 20 }));
    schedule.studyBlocks.push(block("05:45"), block("05:00"),
      block("06:00", "completed"), block("06:00", "skipped"), block("06:00", "unfinished"),
      { ...block("06:00"), taskId: "done" });
    const before = JSON.stringify(schedule);
    const advice = studyAdvice(schedule, now);
    assert.equal(advice.type, "session");
    if (advice.type !== "session") return;
    assert.equal(advice.taskName, "Statistics");
    assert.equal(+advice.block.startTime, +at("07:00"));
    assert.equal(advice.durationMinutes, 30);
    assert.match(advice.reason, /earliest upcoming/);
    assert.match(advice.reason, /saved .*minute session limit/);
    assert.equal(JSON.stringify(schedule), before);
  });

  it("prompts for regeneration when stale and labels known shortages separately", () => {
    const schedule = plan();
    schedule.needsReplan = true;
    schedule.warnings = [{ taskId: "stats", unscheduledMinutes: 15, reason: "No space" }];
    assert.deepEqual(studyAdvice(schedule, now), { type: "stale", shortages: [{ taskId: "stats", name: "Statistics", minutes: 15 }] });
  });

  it("handles no upcoming session, with or without known unscheduled work", () => {
    const schedule = plan();
    schedule.studyBlocks = [block("05:00"), block("08:00", "completed")];
    assert.deepEqual(studyAdvice(schedule, now), { type: "none", shortages: [] });
    schedule.warnings = [{ taskId: "stats", unscheduledMinutes: 60, reason: "No space" }];
    assert.equal(studyAdvice(schedule, now).shortages[0].minutes, 60);
  });

  it("separates a shortage from a recommendation and makes no unsupported preference claim", () => {
    const schedule = plan();
    schedule.warnings = [{ taskId: "stats", unscheduledMinutes: 15, reason: "No space" }];
    schedule.preferences.maxSessionTimeMinutes = 15;
    const advice = studyAdvice(schedule, now);
    assert.equal(advice.type, "session");
    assert.equal(advice.shortages[0].minutes, 15);
    if (advice.type === "session") assert.doesNotMatch(advice.reason, /limit|wake|prefer|morning/);
  });
});
