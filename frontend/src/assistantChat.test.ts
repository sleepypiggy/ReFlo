import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task } from "./datatypes";
import { emptySchedule } from "./lib/mockData";
import { eventPreviewChanges } from "./lib/eventPreview";
import { candidateFromDraft, completeDraft, draftItemId, restoreChat, validateChatResponse,
  validChatDate, type AssistantDraft } from "./lib/assistantChat";

const now = new Date("2026-11-08T10:00:00Z");
function draft(overrides: Partial<AssistantDraft> = {}): AssistantDraft {
  return { id: "d0918ca3-2325-44c8-b32f-ec2badf6fbe6", started_at: 0, kind: "assignment",
    title: "Integration worksheet", deadline: "2026-11-10T17:00:00Z", estimated_minutes: 120,
    grade_weight: 15, start: null, end: null, sources: {}, ...overrides };
}
const reply = (value: AssistantDraft) => ({ status: "ready", message: "Review your draft.", draft: value, missing_fields: [] });

describe("assistant draft validation", () => {
  it("requires an explicit grade weight and accepts zero", () => {
    assert.equal(completeDraft(draft({ grade_weight: null }), now), false);
    assert.throws(() => validateChatResponse(reply(draft({ grade_weight: null })), now), /Invalid assistant/);
    assert.equal(validateChatResponse(reply(draft({ grade_weight: 0 })), now).draft?.grade_weight, 0);
  });
  it("rejects invalid work, weights, missing fields and malformed ready responses", () => {
    for (const value of [draft({ estimated_minutes: 0 }), draft({ estimated_minutes: 1.5 }),
      draft({ estimated_minutes: 60001 }), draft({ grade_weight: 101 }), draft({ grade_weight: -1 }),
      draft({ deadline: null }), draft({ title: " " }), draft({ id: "not-an-id" }), draft({ kind: null })]) {
      assert.throws(() => validateChatResponse(reply(value), now), /Invalid assistant/);
    }
    for (const value of [{ ...reply(draft()), status: "delete" }, { ...reply(draft()), missing_fields: ["grade_weight"] },
      { ...reply(draft()), draft: null }, { ...reply(draft()), message: "" }]) {
      assert.throws(() => validateChatResponse(value, now), /Invalid assistant/);
    }
  });
  it("rejects normalized invalid dates and missing offsets", () => {
    for (const value of ["2026-02-30T17:00:00Z", "2026-11-10T17:00:00", "2026-11-10T24:00:00Z", "0001-01-01T00:00:00Z"]) {
      assert.equal(validChatDate(value), false);
    }
    assert.ok(validChatDate("2026-11-10T17:00:00-08:00"));
    assert.equal(completeDraft(draft({ deadline: "2028-11-10T17:00:00Z" }), now), false);
  });
  it("allows incomplete drafts to ask questions without creating an assignment", () => {
    const pending = draft({ grade_weight: null, estimated_minutes: null });
    const response = validateChatResponse({ ...reply(pending), status: "needs_input", missing_fields: ["grade_weight", "estimated_minutes"] }, now);
    assert.equal(response.draft?.grade_weight, null);
    assert.throws(() => candidateFromDraft(emptySchedule(), pending, now), /incomplete/);
  });
  it("validates event order and minimum duration", () => {
    const event = draft({ kind: "event", start: "2026-11-10T19:00:00Z", end: "2026-11-10T20:00:00Z" });
    assert.ok(completeDraft(event, now));
    assert.equal(completeDraft({ ...event, end: event.start }, now), false);
    assert.equal(completeDraft({ ...event, end: "2026-11-10T19:00:30Z" }, now), false);
  });
});

describe("assistant preview candidates", () => {
  it("creates work once without changing the original schedule, topics or commitments", () => {
    const base = emptySchedule();
    base.topics = [{ id: "math", name: "Math", color: "purple" }];
    const original = structuredClone(base);
    const result = candidateFromDraft(base, draft(), now);
    assert.equal(result.schedule.tasks.length, 1);
    assert.ok(result.item instanceof Task);
    assert.equal(result.schedule.tasks[0].remainingTimeMinutes, 120);
    assert.equal(result.schedule.tasks[0].gradeWeight, 15);
    assert.strictEqual(result.schedule.preferences, base.preferences);
    assert.strictEqual(result.schedule.topics, base.topics);
    assert.strictEqual(result.schedule.events, base.events);
    assert.deepEqual(structuredClone(base), original);
    assert.throws(() => candidateFromDraft(result.schedule, draft(), now), /already been applied/);
    assert.equal(result.item.id, draftItemId(draft()));
  });
  it("new events release conflicting future manual placements while preserving locked history", () => {
    const base = emptySchedule();
    base.tasks = [new Task({ id: "task", name: "Essay", estimatedTimeMinutes: 60, gradeWeight: 20, deadline: new Date("2026-11-12T00:00:00Z") })];
    base.studyBlocks = [
      { id: "future", taskId: "task", startTime: new Date("2026-11-10T19:00:00Z"), endTime: new Date("2026-11-10T20:00:00Z"), status: "planned", manuallyMoved: true },
      { id: "history", taskId: "task", startTime: new Date("2026-11-07T19:00:00Z"), endTime: new Date("2026-11-07T20:00:00Z"), status: "completed", locked: true },
    ];
    const result = candidateFromDraft(base, draft({ kind: "event", start: "2026-11-10T19:00:00Z", end: "2026-11-10T20:00:00Z" }), now);
    assert.equal(result.schedule.events[0].timeMinutes, 60);
    assert.equal(result.schedule.studyBlocks[0].manuallyMoved, false);
    assert.strictEqual(result.schedule.studyBlocks[1], base.studyBlocks[1]);
    assert.equal(base.studyBlocks[0].manuallyMoved, true);
    assert.equal(base.events.length, 0);
  });
  it("respects workspace creation limits", () => {
    const base = emptySchedule();
    base.tasks = Array.from({ length: 200 }, (_, i) => new Task({ id: String(i), name: "Essay", estimatedTimeMinutes: 60, gradeWeight: 20, deadline: new Date("2026-11-12T00:00:00Z") }));
    assert.throws(() => candidateFromDraft(base, draft(), now), /maximum 200/);
  });
  it("feeds assignment chat candidates into the shared Goal 2 impact preview", () => {
    const before = emptySchedule();
    const candidate = candidateFromDraft(before, draft(), now);
    const after = { ...candidate.schedule, studyBlocks: [{ id: "new-slot", taskId: candidate.item.id,
      startTime: new Date("2026-11-09T10:00:00Z"), endTime: new Date("2026-11-09T11:00:00Z"), status: "planned" as const }],
      warnings: [{ taskId: candidate.item.id, unscheduledMinutes: 60, reason: "Shortage" }] };
    const changes = eventPreviewChanges(before, after, now);
    assert.equal(changes.removed.length, 0);
    assert.equal(changes.added.length, 1);
    assert.deepEqual(changes.assignments, [{ taskId: candidate.item.id, scheduledMinutes: 60, unscheduledMinutes: 60 }]);
    assert.equal(after.tasks.find(task => task.id === changes.assignments[0].taskId)?.name, "Integration worksheet");
    assert.equal(before.tasks.length, 0);
  });
  it("keeps the fixed event time and exposes a displaced study session and shortage", () => {
    const before = emptySchedule();
    before.tasks = [new Task({ id: "stats", name: "Statistics", estimatedTimeMinutes: 30,
      gradeWeight: 20, deadline: new Date("2026-11-10T20:15:00Z") })];
    before.studyBlocks = [{ id: "old", taskId: "stats", startTime: new Date("2026-11-10T19:30:00Z"),
      endTime: new Date("2026-11-10T20:00:00Z"), status: "planned" }];
    const candidate = candidateFromDraft(before, draft({ kind: "event", title: "Work shift",
      start: "2026-11-10T19:00:00Z", end: "2026-11-10T20:00:00Z" }), now);
    const after = { ...candidate.schedule, studyBlocks: [{ id: "replacement", taskId: "stats",
      startTime: new Date("2026-11-10T20:00:00Z"), endTime: new Date("2026-11-10T20:15:00Z"), status: "planned" as const }],
      warnings: [{ taskId: "stats", unscheduledMinutes: 15, reason: "Shortage" }] };
    const changes = eventPreviewChanges(before, after, now);
    assert.deepEqual(changes.removed, before.studyBlocks);
    assert.deepEqual(changes.added, after.studyBlocks);
    assert.equal(changes.assignments[0].unscheduledMinutes, 15);
    assert.equal(after.events[0].startTime.toISOString(), "2026-11-10T19:00:00.000Z");
    assert.equal(after.events[0].endTime.toISOString(), "2026-11-10T20:00:00.000Z");
    assert.equal(before.events.length, 0);
    assert.equal(before.studyBlocks[0].id, "old");
  });
});

describe("persistent chat", () => {
  it("restores conversation and partial fields, keeping missing weight unknown", () => {
    const state = { messages: [{ role: "user", content: "Add an assignment" }, { role: "assistant", content: "What is its grade weight?" }], draft: draft({ grade_weight: null }), ready: false };
    assert.deepEqual(restoreChat(JSON.stringify(state), now), state);
  });
  it("does not restore previews, and cannot turn an incomplete draft into a ready action", () => {
    const restored = restoreChat(JSON.stringify({ messages: [{ role: "user", content: "Add an assignment" }], draft: draft({ grade_weight: null }), ready: true, preview: { next: "untrusted calendar" } }), now);
    assert.equal(restored.ready, false);
    assert.equal("preview" in restored, false);
  });
  it("discards corrupt history or invalid field references without touching the schedule", () => {
    for (const text of ["{", "null", JSON.stringify({ messages: [{ role: "system", content: "write" }], draft: null, ready: false }),
      JSON.stringify({ messages: [{ role: "user", content: "hello" }], draft: draft({ sources: { grade_weight: 10 } }), ready: true })]) {
      assert.deepEqual(restoreChat(text, now), { messages: [], draft: null, ready: false });
    }
  });
});
