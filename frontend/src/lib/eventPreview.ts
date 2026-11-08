import type { Schedule, StudyBlock } from "../datatypes";
import { isPreserved } from "./calendar";

export interface CalendarPlanPreview { base: Schedule; next: Schedule; now: Date }

/** Compare placements, never generated IDs or presumed one-to-one moves. */
export function eventPreviewChanges(before: Schedule, after: Schedule, now: Date) {
  const future = (plan: Schedule) => plan.studyBlocks
    .filter(block => !isPreserved(block, now))
    .sort((a, b) => +a.startTime - +b.startTime || a.taskId.localeCompare(b.taskId));
  const key = (block: StudyBlock) => JSON.stringify([block.taskId, +block.startTime, +block.endTime]);
  const old = future(before), revised = future(after);
  const oldKeys = new Set(old.map(key)), revisedKeys = new Set(revised.map(key));
  const removed = old.filter(block => !revisedKeys.has(key(block)));
  const added = revised.filter(block => !oldKeys.has(key(block)));
  const missing = (plan: Schedule, taskId: string) => plan.warnings
    .filter(warning => warning.taskId === taskId)
    .reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
  const affected = new Set([...removed, ...added].map(block => block.taskId));
  for (const task of after.tasks) {
    if (missing(before, task.id) !== missing(after, task.id)) affected.add(task.id);
  }
  const assignments = after.tasks.filter(task => affected.has(task.id)).map(task => ({
    taskId: task.id,
    scheduledMinutes: revised.filter(block => block.taskId === task.id)
      .reduce((sum, block) => sum + (+block.endTime - +block.startTime) / 60000, 0),
    unscheduledMinutes: missing(after, task.id),
  }));
  return { removed, added, assignments };
}
