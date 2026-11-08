import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type Schedule, type StudyBlock } from "./datatypes";
import { initialWorkspace } from "./lib/storage";
import { candidateLimits, checkShortageSuggestions, describeAdjustment, minutesLabel,
  scheduledMinutes, shortageRows, shortagesAreStale, suggestionIsCurrent, type ScheduleRunner } from "./lib/shortages";
import { generateSchedule } from "./lib/api";

const now = new Date("2026-11-10T08:00:00Z");
function block(id: string, minutes: number, taskId = "chem", start = "2026-11-10T09:00:00Z"): StudyBlock {
  return { id, taskId, startTime: new Date(start), endTime: new Date(+new Date(start) + minutes * 60000), status: "planned" };
}
function baseline(): Schedule {
  return { ...initialWorkspace().backend, preferences: { ...initialWorkspace().backend.preferences, maxStudyTimeMinutes: 120 },
    tasks: [new Task({ id: "chem", name: "Chemistry", estimatedTimeMinutes: 240, remainingTimeMinutes: 180,
      gradeWeight: 20, deadline: new Date("2026-11-12T12:00:00Z") })],
    studyBlocks: [block("base", 120)], warnings: [{ taskId: "chem", unscheduledMinutes: 60, reason: "Generic reason" }] };
}

describe("informational shortage suggestions", () => {
  it("counts exact minutes, future planned reservations and remaining work without double-crediting history", () => {
    const schedule = baseline();
    schedule.studyBlocks = [block("future", 60), { ...block("manual", 30, "chem", "2026-11-11T09:00:00Z"), manuallyMoved: true },
      block("ongoing", 60, "chem", "2026-11-10T07:30:00Z"),
      { ...block("completed", 100), status: "completed" }, { ...block("unfinished", 20), status: "unfinished" },
      { ...block("skipped", 25), status: "skipped" }, block("past", 60, "chem", "2026-11-09T09:00:00Z")];
    assert.equal(scheduledMinutes(schedule.studyBlocks, "chem", now), 120);
    assert.equal(shortageRows(schedule, now)[0].task.remainingTimeMinutes, 180);
    assert.equal(shortagesAreStale(schedule, now), false);
    assert.equal(minutesLabel(151), "2 hours 31 minutes");
    assert.equal(minutesLabel(0), "0 minutes");
  });

  it("checks a baseline and bounded candidates with identical inputs and frozen time, without saving", async () => {
    const schedule = baseline(), original = JSON.stringify(schedule);
    const calls: number[] = [];
    const run: ScheduleRunner = async (input, at, signal) => {
      assert.equal(at, now); assert.ok(signal);
      const limit = input.preferences.maxStudyTimeMinutes;
      calls.push(limit);
      assert.deepEqual({ ...input, preferences: schedule.preferences }, schedule);
      return { studyBlocks: [block("trial", limit === 120 ? 120 : 180)], warnings: limit === 120 ? schedule.warnings : [] };
    };
    const result = await checkShortageSuggestions(schedule, run, now);
    assert.deepEqual(calls, [120, 150, 180, 240]);
    assert.match(result.suggestions[0].message, /from 2 hours to 2 hours 30 minutes/);
    assert.match(result.suggestions[0].message, /All remaining work fits/);
    assert.doesNotMatch(result.suggestions[0].message, /Generic reason|sole cause/);
    assert.equal(JSON.stringify(schedule), original);
  });

  it("reports partial improvement and exact outstanding work", async () => {
    const schedule = baseline();
    const result = await checkShortageSuggestions(schedule, async input => {
      const scheduled = input.preferences.maxStudyTimeMinutes === 120 ? 120 : 150;
      return { studyBlocks: [block("trial", scheduled)], warnings: [{ taskId: "chem", unscheduledMinutes: 180 - scheduled, reason: "Generic" }] };
    }, now);
    assert.match(result.suggestions[0].message, /fit 30 minutes more/);
    assert.match(result.suggestions[0].message, /leaves 30 minutes unscheduled for this assignment/);
    assert.match(result.suggestions[0].message, /30 minutes remains unscheduled across all assignments/);
    assert.doesNotMatch(result.suggestions[0].message, /All remaining work fits/);
  });

  it("discloses losses for assignments without original shortages and names dated additions", () => {
    const schedule = baseline();
    schedule.tasks.push(new Task({ id: "math", name: "Math", estimatedTimeMinutes: 60, gradeWeight: 10, deadline: schedule.tasks[0].deadline }));
    schedule.studyBlocks.push(block("math", 60, "math", "2026-11-11T09:00:00Z"));
    const message = describeAdjustment(schedule, { studyBlocks: [block("chem", 180), block("math", 30, "math")], warnings: [] }, "chem", 150, now);
    assert.match(message, /Tradeoff: Math loses 30 minutes/);
    assert.match(message, /adding 1 hour on/);
    assert.match(message, /30 minutes remains unscheduled across all assignments/);
  });

  it("states when no tested increase resolves the shortage, including the maximum limit", async () => {
    const schedule = baseline();
    const result = await checkShortageSuggestions(schedule, async () => schedule, now);
    assert.equal(result.suggestions[0].message, "No tested daily-limit increase resolved the shortage.");
    assert.deepEqual(candidateLimits(1430), [1440]);
    assert.deepEqual(candidateLimits(1440), []);
  });

  it("rejects stale shortages and a changed scheduler baseline", async () => {
    const schedule = baseline();
    let calls = 0;
    const run: ScheduleRunner = async () => { calls++; return { studyBlocks: [], warnings: [{ taskId: "chem", unscheduledMinutes: 180, reason: "Generic" }] }; };
    assert.equal((await checkShortageSuggestions({ ...schedule, needsReplan: true }, run, now)).stale, true);
    assert.equal(calls, 0);
    assert.equal((await checkShortageSuggestions(schedule, run, now)).stale, true);
    assert.equal(calls, 1);
    assert.equal(shortagesAreStale({ ...schedule, studyBlocks: [] }, now), true);
  });

  it("invalidates after relevant edits, placement changes, or elapsed time", async () => {
    const schedule = baseline();
    const result = await checkShortageSuggestions(schedule, async () => schedule, now);
    assert.equal(suggestionIsCurrent(result, schedule, now), true);
    for (const changed of [
      { ...schedule, tasks: [{ ...schedule.tasks[0], gradeWeight: 50 }] },
      { ...schedule, tasks: [{ ...schedule.tasks[0], remainingTimeMinutes: 200 }] },
      { ...schedule, tasks: [{ ...schedule.tasks[0], deadline: new Date("2026-11-13T12:00:00Z") }] },
      { ...schedule, preferences: { ...schedule.preferences, breakDurationMinutes: 30 } },
      { ...schedule, studyBlocks: [{ ...schedule.studyBlocks[0], manuallyMoved: true }] },
      { ...schedule, needsReplan: true },
    ]) assert.equal(suggestionIsCurrent(result, changed, now), false);
    assert.equal(suggestionIsCurrent(result, schedule, new Date(+now + 5 * 60000)), false);
  });

  it("propagates request failures without returning partial suggestions or changing the saved plan", async () => {
    const schedule = baseline(), original = JSON.stringify(schedule);
    let count = 0;
    await assert.rejects(checkShortageSuggestions(schedule, async () => {
      if (++count === 3) throw new Error("Request failed");
      return { studyBlocks: [block("trial", count === 1 ? 120 : 180)], warnings: count === 1 ? schedule.warnings : [] };
    }, now), /Request failed/);
    assert.equal(JSON.stringify(schedule), original);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(checkShortageSuggestions(schedule, async () => schedule, now, controller.signal));
  });

  it("uses existing API response validation and leaves saved data intact on HTTP and malformed response failures", async () => {
    const originalFetch = globalThis.fetch, schedule = baseline(), original = JSON.stringify(schedule);
    try {
      globalThis.fetch = async () => new Response("{}", { status: 503 });
      await assert.rejects(checkShortageSuggestions(schedule, generateSchedule, now));
      globalThis.fetch = async () => new Response(JSON.stringify({ study_blocks: [{ id: "bad", task_id: "unknown" }], unscheduled: [] }));
      await assert.rejects(checkShortageSuggestions(schedule, generateSchedule, now), /invalid task/);
      assert.equal(JSON.stringify(schedule), original);
    } finally { globalThis.fetch = originalFetch; }
  });

  it("never requests suggestions for demo workspaces", async () => {
    const result = await checkShortageSuggestions({ ...baseline(), source: "demo" }, async () => { throw new Error("Must not request"); }, now);
    assert.deepEqual(result.suggestions, []);
  });

  it("rejects inconsistent candidate minute totals rather than reporting a false fit", async () => {
    const schedule = baseline();
    let calls = 0;
    await assert.rejects(checkShortageSuggestions(schedule, async () => ++calls === 1 ? schedule :
      { studyBlocks: [block("too-much", 200)], warnings: [] }, now), /inconsistent work totals/);
  });
});
