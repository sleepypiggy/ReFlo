import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type StudyBlock } from "./datatypes";
import { initialWorkspace } from "./lib/storage";
import { eventPreviewChanges } from "./lib/eventPreview";

const at = (time: string) => new Date(`2026-11-10T${time}:00Z`);
const now = at("18:00");
const block = (id: string, start: string, end: string): StudyBlock => ({
  id, taskId: "statistics", startTime: at(start), endTime: at(end), status: "planned",
});
function baseline() {
  const plan = initialWorkspace().backend;
  plan.tasks = [new Task({ id: "statistics", name: "Statistics", estimatedTimeMinutes: 30,
    deadline: at("20:15"), gradeWeight: 20 })];
  plan.studyBlocks = [block("old", "19:30", "20:00")];
  return plan;
}

describe("fixed-event preview changes", () => {
  it("reports a shortened replacement and exact shortage without mutating the original", () => {
    const before = baseline();
    const after = { ...before, studyBlocks: [block("new", "20:00", "20:15")],
      warnings: [{ taskId: "statistics", unscheduledMinutes: 15, reason: "Deadline" }] };
    assert.deepEqual(eventPreviewChanges(before, after, now), {
      removed: before.studyBlocks, added: after.studyBlocks,
      assignments: [{ taskId: "statistics", scheduledMinutes: 15, unscheduledMinutes: 15 }],
    });
    assert.equal(before.studyBlocks[0].id, "old");
    assert.deepEqual(before.warnings, []);
  });

  it("ignores regenerated IDs and preserved history", () => {
    const before = baseline();
    before.studyBlocks.push(
      { ...block("completed", "18:30", "19:00"), status: "completed" },
      { ...block("locked", "21:00", "21:30"), locked: true },
      { ...block("manual", "22:00", "22:30"), manuallyMoved: true },
      block("past", "16:00", "17:00"),
      { ...block("unfinished", "17:00", "18:30"), status: "unfinished" },
    );
    const after = { ...before, studyBlocks: [{ ...before.studyBlocks[0], id: "regenerated" }] };
    assert.deepEqual(eventPreviewChanges(before, after, now), { removed: [], added: [], assignments: [] });
  });

  it("lists both parts of a split independently and reports zero shortage", () => {
    const before = baseline();
    const after = { ...before, studyBlocks: [block("a", "20:00", "20:15"), block("b", "20:30", "20:45")] };
    const changes = eventPreviewChanges(before, after, now);
    assert.deepEqual(changes.removed, before.studyBlocks);
    assert.deepEqual(changes.added, after.studyBlocks);
    assert.deepEqual(changes.assignments, [{ taskId: "statistics", scheduledMinutes: 30, unscheduledMinutes: 0 }]);
    assert.equal("moved" in changes, false);
  });

  it("keeps tasks distinct at identical times and includes shortage-only changes", () => {
    const before = baseline();
    before.tasks.push(new Task({ id: "other", name: "Other", estimatedTimeMinutes: 10,
      deadline: at("21:00"), gradeWeight: 10 }));
    const after = { ...before, studyBlocks: [{ ...before.studyBlocks[0], taskId: "other" }],
      warnings: [{ taskId: "statistics", unscheduledMinutes: 30, reason: "Deadline" }] };
    const changes = eventPreviewChanges(before, after, now);
    assert.equal(changes.removed[0].taskId, "statistics");
    assert.equal(changes.added[0].taskId, "other");
    const warningOnly = eventPreviewChanges(before, { ...before, warnings: after.warnings }, now);
    assert.equal(warningOnly.assignments[0].unscheduledMinutes, 30);
  });
});
