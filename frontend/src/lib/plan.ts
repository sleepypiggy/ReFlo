import type { Schedule, StudyBlock } from "../datatypes";
import { expandEvents, isPreserved } from "./calendar";

/** Fixed commitments win over movable future study, including weekly repeats. */
export function hasStudyConflict(schedule: Schedule, now = new Date()) {
  return schedule.studyBlocks.some(block => !isPreserved(block, now) &&
    expandEvents(schedule.events, block.startTime, block.endTime).some(event =>
      event.startTime < block.endTime && event.endTime > block.startTime));
}

export function upcomingMinutes(schedule: Schedule, now = new Date()) {
  return schedule.studyBlocks.filter(block => block.status === "planned").reduce((sum, block) =>
    sum + Math.max(0, Math.floor((+block.endTime - Math.max(+block.startTime, +now)) / 60000)), 0);
}

/** Ignore regenerated IDs: an unchanged task/time slot is still unchanged. */
export function planChanges(before: Schedule, after: Schedule, now: Date) {
  const future = (plan: Schedule) => plan.studyBlocks.filter(block => !isPreserved(block, now));
  const key = (block: StudyBlock) => `${block.taskId}:${+block.startTime}:${+block.endTime}`;
  const old = future(before), fresh = future(after);
  const oldKeys = new Set(old.map(key)), newKeys = new Set(fresh.map(key));
  const removed = old.filter(block => !newKeys.has(key(block)));
  const added = fresh.filter(block => !oldKeys.has(key(block)));
  const taskIds = new Set([...removed, ...added].map(block => block.taskId));
  const moved = [...taskIds].reduce((sum, id) => sum + Math.min(
    removed.filter(block => block.taskId === id).length,
    added.filter(block => block.taskId === id).length,
  ), 0);
  return { moved, added: added.length - moved, removed: removed.length - moved };
}
