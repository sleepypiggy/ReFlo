import { Task, type Schedule, type TaskInput } from "./datatypes";

/** Add a task without modifying the original schedule. IDs must be unique. */
export function addTask(schedule: Schedule, input: TaskInput): Schedule {
  if (schedule.tasks.some((task) => task.id === input.id)) {
    throw new Error(`A task with ID "${input.id}" already exists.`);
  }

  return {
    ...schedule,
    tasks: [...schedule.tasks, new Task(input)],
  };
}

/** Remove a task by ID. An unknown ID leaves the schedule unchanged. */
export function removeTask(schedule: Schedule, taskId: string): Schedule {
  if (!schedule.tasks.some((task) => task.id === taskId)) {
    return schedule;
  }

  return {
    ...schedule,
    tasks: schedule.tasks.filter((task) => task.id !== taskId),
  };
}

/**
 * Record the total work remaining after the student selects "I didn't finish".
 * The caller collects minutes from the student before calling this function.
 * Replaces the previous remaining time; does not add to it or change the
 * original estimate. Zero means no work remains; fractional minutes are allowed.
 * Calendar times are preserved. Future session regeneration is handled separately.
 */
export function markTaskUnfinished(
  schedule: Schedule,
  taskId: string,
  remainingMinutes: number,
): Schedule {
  if (!Number.isFinite(remainingMinutes) || remainingMinutes < 0) {
    throw new RangeError("Remaining time must be a finite, non-negative number of minutes.");
  }

  const taskIndex = schedule.tasks.findIndex((task) => task.id === taskId);
  if (taskIndex === -1) {
    throw new Error(`No task with ID "${taskId}" exists.`);
  }

  return {
    ...schedule,
    tasks: schedule.tasks.map((task, index) =>
      index === taskIndex
        ? new Task({ ...task, remainingTimeMinutes: remainingMinutes })
        : task,
    ),
  };
}

/**
 * Return a task's scheduled slot to unscheduled work and retain the skipped
 * entry for calendar history. Remaining time already includes uncompleted work,
 * so skipping never adds minutes or resets progress. Repeated calls on an
 * unscheduled task are a no-op. Future scheduling is handled separately.
 */
export function skipTask(schedule: Schedule, taskId: string): Schedule {
  const task = schedule.tasks.find((task) => task.id === taskId);
  if (!task) {
    throw new Error(`No task with ID "${taskId}" exists.`);
  }

  if (!Number.isFinite(task.remainingTimeMinutes) || task.remainingTimeMinutes <= 0) {
    throw new RangeError("Only tasks with positive, finite remaining time can be skipped.");
  }

  if (task.startTime === undefined && task.endTime === undefined) {
    return schedule;
  }

  if (
    !task.startTime ||
    !task.endTime ||
    !Number.isFinite(task.startTime.getTime()) ||
    !Number.isFinite(task.endTime.getTime()) ||
    task.endTime.getTime() <= task.startTime.getTime()
  ) {
    throw new RangeError("A scheduled task must have valid start and end times, with end after start.");
  }

  return {
    ...schedule,
    tasks: schedule.tasks.map((item) =>
      item === task
        ? new Task({ ...item, startTime: undefined, endTime: undefined })
        : item,
    ),
    skippedSessions: [
      ...(schedule.skippedSessions ?? []),
      {
        taskId: task.id,
        taskName: task.name,
        startTime: task.startTime,
        endTime: task.endTime,
      },
    ],
  };
}
