import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Task, type Schedule, type TaskInput } from "./datatypes";
import { addTask, markTaskUnfinished, removeTask, skipTask } from "./taskFunctions";

function makeInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    id: "assignment-1",
    name: "Math assignment",
    estimatedTimeMinutes: 90,
    deadline: new Date("2026-11-13T23:59:00-08:00"),
    gradeWeight: 20,
    ...overrides,
  };
}

function makeSchedule(tasks: Task[] = []): Schedule {
  return {
    weekStart: new Date("2026-11-09T00:00:00-08:00"),
    tasks,
    events: [],
    studyBlocks: [],
    warnings: [],
    source: "demo",
    preferences: {
      maxStudyTimeMinutes: 240,
      maxSessionTimeMinutes: 60,
      sleepHours: { bedtime: "23:00", wakeUpTime: "07:00" },
      breakDurationMinutes: 15,
    },
  };
}

describe("addTask", () => {
  it("adds a Task to an empty schedule with default remaining time", () => {
    const input = makeInput();
    const result = addTask(makeSchedule(), input);

    assert.equal(result.tasks.length, 1);
    assert.ok(result.tasks[0] instanceof Task);
    assert.deepEqual(result.tasks[0], new Task(input));
    assert.equal(result.tasks[0].remainingTimeMinutes, 90);
  });

  it("preserves supplied remaining time, including zero, and scheduled times", () => {
    for (const remainingTimeMinutes of [30, 0]) {
      const input = makeInput({
        remainingTimeMinutes,
        startTime: new Date("2026-11-10T10:00:00-08:00"),
        endTime: new Date("2026-11-10T11:30:00-08:00"),
      });
      const result = addTask(makeSchedule(), input);

      assert.deepEqual(result.tasks[0], new Task(input));
      assert.equal(result.tasks[0].remainingTimeMinutes, remainingTimeMinutes);
    }
  });

  it("appends without changing the original schedule or other fields", () => {
    const existingTask = new Task(makeInput());
    const schedule = makeSchedule([existingTask]);
    Object.freeze(schedule.tasks);
    Object.freeze(schedule);

    const result = addTask(schedule, makeInput({ id: "assignment-2" }));

    assert.notStrictEqual(result, schedule);
    assert.notStrictEqual(result.tasks, schedule.tasks);
    assert.deepEqual(schedule.tasks, [existingTask]);
    assert.equal(result.tasks.length, 2);
    assert.strictEqual(result.tasks[0], existingTask);
    assert.strictEqual(result.weekStart, schedule.weekStart);
    assert.strictEqual(result.events, schedule.events);
    assert.strictEqual(result.preferences, schedule.preferences);
  });

  it("rejects duplicate IDs without changing the existing task", () => {
    const existingTask = new Task(makeInput());
    const schedule = makeSchedule([existingTask]);

    assert.throws(
      () => addTask(schedule, makeInput({ name: "Different assignment" })),
      { message: 'A task with ID "assignment-1" already exists.' },
    );
    assert.deepEqual(schedule.tasks, [existingTask]);
    assert.equal(existingTask.name, "Math assignment");
  });
});

describe("removeTask", () => {
  it("removes only the matching ID and preserves the original schedule", () => {
    const first = new Task(makeInput({ id: "first" }));
    const middle = new Task(makeInput({ id: "middle" }));
    const last = new Task(makeInput({ id: "last" }));
    const schedule = makeSchedule([first, middle, last]);
    Object.freeze(schedule.tasks);
    Object.freeze(schedule);

    const result = removeTask(schedule, "middle");

    assert.notStrictEqual(result, schedule);
    assert.notStrictEqual(result.tasks, schedule.tasks);
    assert.deepEqual(result.tasks, [first, last]);
    assert.strictEqual(result.tasks[0], first);
    assert.strictEqual(result.tasks[1], last);
    assert.deepEqual(schedule.tasks, [first, middle, last]);
    assert.strictEqual(result.weekStart, schedule.weekStart);
    assert.strictEqual(result.events, schedule.events);
    assert.strictEqual(result.preferences, schedule.preferences);
  });

  it("can remove the final task", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    assert.deepEqual(removeTask(schedule, "assignment-1").tasks, []);
    assert.equal(schedule.tasks.length, 1);
  });

  it("returns the original schedule for an unknown ID", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    assert.strictEqual(removeTask(schedule, "unknown"), schedule);
    assert.equal(schedule.tasks.length, 1);
  });

  it("handles an empty schedule", () => {
    const schedule = makeSchedule();

    assert.strictEqual(removeTask(schedule, "unknown"), schedule);
    assert.deepEqual(schedule.tasks, []);
  });
});

describe("markTaskUnfinished", () => {
  it("replaces the remaining time while preserving the original estimate", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    const result = markTaskUnfinished(schedule, "assignment-1", 45);

    assert.equal(result.tasks[0].remainingTimeMinutes, 45);
    assert.equal(result.tasks[0].estimatedTimeMinutes, 90);
    assert.ok(result.tasks[0] instanceof Task);
  });

  it("allows revised estimates larger than the original estimate", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    const result = markTaskUnfinished(schedule, "assignment-1", 120);

    assert.equal(result.tasks[0].remainingTimeMinutes, 120);
    assert.equal(result.tasks[0].estimatedTimeMinutes, 90);
  });

  it("replaces rather than accumulates estimates on repeated reports", () => {
    const schedule = makeSchedule([new Task(makeInput())]);
    const firstReport = markTaskUnfinished(schedule, "assignment-1", 60);
    const secondReport = markTaskUnfinished(firstReport, "assignment-1", 20);

    assert.equal(secondReport.tasks[0].remainingTimeMinutes, 20);
    assert.equal(firstReport.tasks[0].remainingTimeMinutes, 60);
    assert.equal(schedule.tasks[0].remainingTimeMinutes, 90);
  });

  it("accepts zero and fractional minutes", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    for (const remainingMinutes of [0, 12.5]) {
      const result = markTaskUnfinished(schedule, "assignment-1", remainingMinutes);
      assert.equal(result.tasks[0].remainingTimeMinutes, remainingMinutes);
    }
  });

  it("preserves calendar times, commitments, other tasks, and the original schedule", () => {
    const input = makeInput({
      startTime: new Date("2026-11-10T10:00:00-08:00"),
      endTime: new Date("2026-11-10T11:30:00-08:00"),
    });
    const task = new Task(input);
    const other = new Task(makeInput({ id: "other" }));
    const schedule = makeSchedule([other, task]);
    schedule.events.push({
      id: "lecture",
      name: "Math lecture",
      timeMinutes: 60,
      remainingTimeMinutes: 60,
      startTime: new Date("2026-11-11T09:00:00-08:00"),
      endTime: new Date("2026-11-11T10:00:00-08:00"),
      repeatOn: [3],
    });
    const original = structuredClone(schedule);
    Object.freeze(task);
    Object.freeze(other);
    Object.freeze(schedule.tasks);
    Object.freeze(schedule.events[0]);
    Object.freeze(schedule.events);
    Object.freeze(schedule);

    const result = markTaskUnfinished(schedule, "assignment-1", 30);

    assert.notStrictEqual(result, schedule);
    assert.notStrictEqual(result.tasks, schedule.tasks);
    assert.notStrictEqual(result.tasks[1], task);
    assert.deepEqual(result.tasks[1], new Task({ ...input, remainingTimeMinutes: 30 }));
    assert.strictEqual(result.tasks[0], other);
    assert.strictEqual(result.weekStart, schedule.weekStart);
    assert.strictEqual(result.events, schedule.events);
    assert.strictEqual(result.preferences, schedule.preferences);
    assert.deepEqual(structuredClone(schedule), original);
  });

  it("rejects invalid remaining time without modifying the schedule", () => {
    const schedule = makeSchedule([new Task(makeInput())]);

    for (const invalid of [-1, NaN, Infinity, -Infinity]) {
      assert.throws(
        () => markTaskUnfinished(schedule, "assignment-1", invalid),
        RangeError,
      );
    }
    assert.equal(schedule.tasks[0].remainingTimeMinutes, 90);
  });

  it("rejects missing tasks, including in an empty schedule", () => {
    for (const schedule of [makeSchedule(), makeSchedule([new Task(makeInput())])]) {
      const originalTasks = [...schedule.tasks];
      assert.throws(
        () => markTaskUnfinished(schedule, "missing", 30),
        { message: 'No task with ID "missing" exists.' },
      );
      assert.deepEqual(schedule.tasks, originalTasks);
    }
  });
});

describe("skipTask", () => {
  function scheduledTask(overrides: Partial<TaskInput> = {}): Task {
    return new Task(makeInput({
      startTime: new Date("2026-11-10T10:00:00-08:00"),
      endTime: new Date("2026-11-10T11:00:00-08:00"),
      ...overrides,
    }));
  }

  it("returns a skipped hour to unscheduled work and preserves its calendar entry", () => {
    const task = scheduledTask({ estimatedTimeMinutes: 60 });
    const result = skipTask(makeSchedule([task]), task.id);

    assert.equal(result.tasks.length, 1);
    assert.ok(result.tasks[0] instanceof Task);
    assert.equal(result.tasks[0].startTime, undefined);
    assert.equal(result.tasks[0].endTime, undefined);
    assert.equal(result.tasks[0].remainingTimeMinutes, 60);
    assert.deepEqual(result.skippedSessions, [{
      taskId: task.id,
      taskName: task.name,
      startTime: task.startTime,
      endTime: task.endTime,
    }]);
  });

  it("preserves previously recorded progress and the original estimate", () => {
    const task = scheduledTask({ remainingTimeMinutes: 30 });
    const result = skipTask(makeSchedule([task]), task.id);

    assert.deepEqual(result.tasks[0], new Task({
      ...task, startTime: undefined, endTime: undefined,
    }));
    assert.equal(result.tasks[0].remainingTimeMinutes, 30);
    assert.equal(result.tasks[0].estimatedTimeMinutes, 90);
  });

  it("does not duplicate skipped history when called again", () => {
    const task = scheduledTask();
    const first = skipTask(makeSchedule([task]), task.id);
    const second = skipTask(first, task.id);

    assert.strictEqual(second, first);
    assert.equal(second.skippedSessions?.length, 1);
    assert.equal(second.tasks[0].remainingTimeMinutes, 90);
  });

  it("leaves an already unscheduled task unchanged", () => {
    const schedule = makeSchedule([new Task(makeInput())]);
    assert.strictEqual(skipTask(schedule, "assignment-1"), schedule);
    assert.equal(schedule.skippedSessions, undefined);
  });

  it("preserves original data, other tasks, fixed commitments, and existing history", () => {
    const task = scheduledTask();
    const other = scheduledTask({ id: "other" });
    const schedule = makeSchedule([other, task]);
    schedule.events.push({
      id: "lecture", name: "Lecture", timeMinutes: 60, remainingTimeMinutes: 60,
      startTime: new Date("2026-11-11T09:00:00-08:00"),
      endTime: new Date("2026-11-11T10:00:00-08:00"),
      repeatOn: [3],
    });
    schedule.skippedSessions = [{
      taskId: "earlier", taskName: "Earlier task",
      startTime: new Date("2026-11-09T09:00:00-08:00"),
      endTime: new Date("2026-11-09T10:00:00-08:00"),
    }];
    const snapshot = structuredClone(schedule);
    Object.freeze(task);
    Object.freeze(schedule.tasks);
    Object.freeze(schedule.skippedSessions);
    Object.freeze(schedule.events[0]);
    Object.freeze(schedule.events);
    Object.freeze(schedule);

    const result = skipTask(schedule, task.id);

    assert.notStrictEqual(result, schedule);
    assert.notStrictEqual(result.tasks, schedule.tasks);
    assert.strictEqual(result.tasks[0], other);
    assert.strictEqual(result.events, schedule.events);
    assert.strictEqual(result.preferences, schedule.preferences);
    assert.strictEqual(result.weekStart, schedule.weekStart);
    assert.equal(result.skippedSessions?.length, 2);
    assert.strictEqual(result.skippedSessions?.[0], schedule.skippedSessions[0]);
    assert.deepEqual(structuredClone(schedule), snapshot);
  });

  it("rejects unknown task IDs", () => {
    assert.throws(() => skipTask(makeSchedule(), "missing"), {
      message: 'No task with ID "missing" exists.',
    });
  });

  it("rejects completed tasks and invalid remaining time", () => {
    for (const remainingTimeMinutes of [0, -1, NaN, Infinity]) {
      const schedule = makeSchedule([scheduledTask({ remainingTimeMinutes })]);
      assert.throws(() => skipTask(schedule, "assignment-1"), RangeError);
      assert.equal(schedule.skippedSessions, undefined);
      assert.ok(schedule.tasks[0].startTime);
    }
  });

  it("rejects incomplete, invalid, or reversed calendar times without changes", () => {
    const cases: Partial<TaskInput>[] = [
      { startTime: undefined },
      { endTime: undefined },
      { startTime: new Date(NaN) },
      { endTime: new Date(NaN) },
      { endTime: new Date("2026-11-10T10:00:00-08:00") },
      { endTime: new Date("2026-11-10T09:00:00-08:00") },
    ];
    for (const overrides of cases) {
      const task = scheduledTask(overrides);
      const schedule = makeSchedule([task]);
      assert.throws(() => skipTask(schedule, task.id), RangeError);
      assert.strictEqual(schedule.tasks[0], task);
      assert.equal(schedule.skippedSessions, undefined);
    }
  });
});
