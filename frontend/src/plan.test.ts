import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type StudyBlock } from "./datatypes";
import { initialWorkspace, exportBackup, importBackup } from "./lib/storage";
import { hasStudyConflict, releaseConflictingPlacements, upcomingMinutes, planChanges } from "./lib/plan";

const now = new Date("2026-11-10T10:00:00Z");
const block = (id: string, start: string, end: string, status: StudyBlock["status"] = "planned"): StudyBlock =>
  ({ id, taskId: "task", startTime: new Date(start), endTime: new Date(end), status });
function schedule() {
  const value = initialWorkspace().backend;
  value.tasks = [new Task({ id: "task", name: "Statistics", estimatedTimeMinutes: 180, deadline: new Date("2026-11-12T12:00:00Z"), gradeWeight: 20 })];
  return value;
}

describe("plan accounting", () => {
  it("releases only conflicting future manual placements when a fixed event wins", () => {
    const plan = schedule();
    plan.events = [{ id: "concert", name: "Concert", startTime: new Date("2026-11-10T11:00:00Z"),
      endTime: new Date("2026-11-10T12:00:00Z"), timeMinutes: 60, remainingTimeMinutes: 60 }];
    plan.studyBlocks = [
      { ...block("overlap", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z"), manuallyMoved: true },
      { ...block("other", "2026-11-10T13:00:00Z", "2026-11-10T14:00:00Z"), manuallyMoved: true },
      { ...block("locked", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z"), manuallyMoved: true, locked: true },
    ];
    assert.equal(hasStudyConflict(plan, now), true);
    const next = releaseConflictingPlacements(plan, now);
    assert.equal(next.studyBlocks[0].manuallyMoved, false);
    assert.equal(next.studyBlocks[1], plan.studyBlocks[1]);
    assert.equal(next.studyBlocks[2], plan.studyBlocks[2]);
    assert.equal(plan.studyBlocks[0].manuallyMoved, true);
  });
  it("detects future commitment overlaps, including later weekly occurrences", () => {
    const plan = schedule();
    plan.studyBlocks = [block("future", "2026-11-17T11:00:00Z", "2026-11-17T12:00:00Z")];
    const startTime = new Date("2026-11-10T11:30:00Z");
    plan.events = [{ id: "work", name: "Work", startTime, endTime: new Date("2026-11-10T12:30:00Z"),
      timeMinutes: 60, remainingTimeMinutes: 60, repeatOn: [startTime.getDay() as 2] }];
    assert.equal(hasStudyConflict(plan, now), true);
    plan.events[0].repeatOn = [];
    assert.equal(hasStudyConflict(plan, now), false);
  });
  it("allows touching boundaries and preserves started, locked and historical entries", () => {
    const plan = schedule();
    plan.events = [{ id: "work", name: "Work", startTime: new Date("2026-11-10T09:00:00Z"),
      endTime: new Date("2026-11-10T11:00:00Z"), timeMinutes: 120, remainingTimeMinutes: 120 }];
    plan.studyBlocks = [block("future", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z"),
      block("started", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z"),
      { ...block("locked", "2026-11-10T10:15:00Z", "2026-11-10T10:45:00Z"), locked: true },
      block("completed", "2026-11-10T10:15:00Z", "2026-11-10T10:45:00Z", "completed")];
    assert.equal(hasStudyConflict(plan, now), false);
    plan.events[0].endTime = new Date("2026-11-10T11:01:00Z");
    assert.equal(hasStudyConflict(plan, now), true);
  });
  it("counts only the future portion of planned sessions", () => {
    const plan = schedule();
    plan.studyBlocks = [
      block("past", "2026-11-10T08:00:00Z", "2026-11-10T09:00:00Z"),
      block("ongoing", "2026-11-10T09:30:00Z", "2026-11-10T10:30:00Z"),
      block("future", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z"),
      block("skipped", "2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z", "skipped"),
    ];
    assert.equal(upcomingMinutes(plan, now), 90);
  });
  it("compares task/time slots instead of generated IDs and ignores history", () => {
    const before = schedule();
    before.studyBlocks = [block("old", "2026-11-10T11:00:00Z", "2026-11-10T12:00:00Z")];
    const same = { ...before, studyBlocks: [{ ...before.studyBlocks[0], id: "new-id" }] };
    assert.deepEqual(planChanges(before, same, now), { moved: 0, added: 0, removed: 0 });
    const moved = { ...before, studyBlocks: [block("new", "2026-11-11T11:00:00Z", "2026-11-11T12:00:00Z")] };
    assert.deepEqual(planChanges(before, moved, now), { moved: 1, added: 0, removed: 0 });
    assert.deepEqual(planChanges(before, { ...before, studyBlocks: [] }, now), { moved: 0, added: 0, removed: 1 });
  });
});

describe("backup validation", () => {
  it("round trips tasks, dates, skipped history and both workspaces", () => {
    const workspace = initialWorkspace();
    workspace.backend = schedule();
    workspace.backend.studyBlocks = [block("skipped", "2026-11-10T08:00:00Z", "2026-11-10T09:00:00Z", "skipped")];
    workspace.mode = "backend";
    const imported = importBackup(exportBackup(workspace));
    assert.equal(imported.mode, "backend");
    assert.ok(imported.backend.tasks[0] instanceof Task);
    assert.ok(imported.backend.tasks[0].deadline instanceof Date);
    assert.equal(imported.backend.studyBlocks[0].status, "skipped");
    assert.equal(imported.backend.needsReplan, true);
    assert.equal(imported.demo.needsReplan, true);
  });
  it("reads older workspaces and flags imported plans for regeneration", () => {
    const workspace = initialWorkspace();
    workspace.backend = schedule();
    const backup = JSON.parse(exportBackup(workspace));
    delete backup.workspace.backend.needsReplan;
    const imported = importBackup(JSON.stringify(backup));
    assert.equal(imported.backend.needsReplan, true);
    assert.equal(imported.backend.tasks[0].gradeWeight, 20);
  });
  it("rejects malformed JSON, unsupported versions, invalid dates and references", () => {
    for (const text of ["{", "null", '{"version":99}']) assert.throws(() => importBackup(text), /Invalid backup/);
    const workspace = initialWorkspace();
    workspace.backend = schedule();
    for (const corrupt of [
      (data: typeof workspace) => { data.backend.tasks[0].gradeWeight = -1; },
      (data: typeof workspace) => { data.backend.tasks.push(data.backend.tasks[0]); },
      (data: typeof workspace) => { data.backend.studyBlocks = [{ ...block("bad", "2026-11-10T11:00:00Z", "2026-11-10T10:00:00Z"), taskId: "missing" }]; },
      (data: typeof workspace) => { data.backend.tasks[0].deadline = new Date("invalid"); },
    ]) {
      const candidate = structuredClone(workspace);
      corrupt(candidate);
      assert.throws(() => importBackup(exportBackup(candidate)), /Invalid backup/);
    }
    assert.equal(workspace.backend.tasks.length, 1);
  });
});
