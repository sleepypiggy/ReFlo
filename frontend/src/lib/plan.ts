import type { Schedule, StudyBlock } from "../datatypes";
import { expandEvents } from "./calendar";
import { eventPreviewChanges } from "./eventPreview";

/** Fixed commitments win over movable future study, including weekly repeats. */
export function hasStudyConflict(schedule: Schedule, now = new Date()) {
  return schedule.studyBlocks.some(block => block.status === "planned" && !block.locked && block.startTime > now &&
    expandEvents(schedule.events, block.startTime, block.endTime).some(event =>
      event.startTime < block.endTime && event.endTime > block.startTime));
}

/** A manually placed future session still yields to a new fixed commitment. */
export function releaseConflictingPlacements(schedule: Schedule, now = new Date()): Schedule {
  return { ...schedule, studyBlocks: schedule.studyBlocks.map(block =>
    block.manuallyMoved && hasStudyConflict({ ...schedule, studyBlocks: [block] }, now)
      ? { ...block, manuallyMoved: false } : block) };
}

export function upcomingMinutes(schedule: Schedule, now = new Date()) {
  return schedule.studyBlocks.filter(block => block.status === "planned").reduce((sum, block) =>
    sum + Math.max(0, Math.floor((+block.endTime - Math.max(+block.startTime, +now)) / 60000)), 0);
}

/** Ignore regenerated IDs: an unchanged task/time slot is still unchanged. */
export function planChangeDetails(before: Schedule, after: Schedule, now: Date) {
  const { removed, added } = eventPreviewChanges(before, after, now);
  const taskIds = new Set([...removed, ...added].map(block => block.taskId));
  const changes: { taskId: string; before?: StudyBlock; after?: StudyBlock }[] = [];
  for (const taskId of taskIds) {
    const oldBlocks = removed.filter(block => block.taskId === taskId).sort((a, b) => +a.startTime - +b.startTime);
    const newBlocks = added.filter(block => block.taskId === taskId).sort((a, b) => +a.startTime - +b.startTime);
    for (let index = 0; index < Math.max(oldBlocks.length, newBlocks.length); index++) {
      changes.push({ taskId, before: oldBlocks[index], after: newBlocks[index] });
    }
  }
  return changes;
}

export function planChanges(before: Schedule, after: Schedule, now: Date) {
  const changes = planChangeDetails(before, after, now);
  return {
    moved: changes.filter(change => change.before && change.after).length,
    added: changes.filter(change => !change.before).length,
    removed: changes.filter(change => !change.after).length,
  };
}
