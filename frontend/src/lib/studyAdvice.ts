import type { Schedule } from "../datatypes";

/** Read the saved plan only: never allocate time or infer preference causality. */
export function studyAdvice(schedule: Schedule, now: Date) {
  const active = schedule.tasks.filter(task => task.remainingTimeMinutes > 0);
  const shortages = active.flatMap(task => {
    const minutes = schedule.warnings.filter(warning => warning.taskId === task.id)
      .reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
    return minutes > 0 ? [{ taskId: task.id, name: task.name, minutes }] : [];
  });
  if (schedule.needsReplan) return { type: "stale" as const, shortages };
  const block = schedule.studyBlocks.filter(block => block.status === "planned" &&
    block.startTime >= now && block.endTime > block.startTime && active.some(task =>
      task.id === block.taskId && task.deadline >= block.endTime && task.deadline > now))
    .sort((a, b) => +a.startTime - +b.startTime || +a.endTime - +b.endTime || a.taskId.localeCompare(b.taskId))[0];
  if (!block) return { type: "none" as const, shortages };
  const task = active.find(task => task.id === block.taskId)!;
  const durationMinutes = (+block.endTime - +block.startTime) / 60000;
  const limit = schedule.preferences.maxSessionTimeMinutes;
  const reason = "This is the earliest upcoming planned session for an active assignment." +
    (durationMinutes <= limit ? ` Its ${durationMinutes} minutes fit your saved ${limit}-minute session limit.` : "");
  return { type: "session" as const, taskName: task.name, block, durationMinutes, reason, shortages };
}
