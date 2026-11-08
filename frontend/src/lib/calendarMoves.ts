import type { Schedule, StudyBlock } from "../datatypes";
import { expandEvents } from "./calendar";

export type CalendarMove =
  | { type: "study"; id: string; startTime: Date }
  | { type: "fixed"; id: string; occurrenceStart: Date; startTime: Date };
export type MoveResult = { schedule: Schedule; error?: never } | { error: string; schedule?: never };

export function canMoveStudy(block: StudyBlock, now = new Date()) {
  return block.status === "planned" && !block.locked && block.startTime > now;
}

const overlaps = (start: Date, end: Date, from: Date, to: Date) => start < to && end > from;
const midnight = (date: Date) => { const day = new Date(date); day.setHours(0, 0, 0, 0); return day; };
const nextDay = (date: Date) => { const day = new Date(date); day.setDate(day.getDate() + 1); return day; };
const clock = (day: Date, value: string) => {
  const result = new Date(day);
  const [hour, minute] = value.split(":").map(Number);
  result.setHours(hour, minute, 0, 0);
  return result;
};

/** Pure, atomic move: callers persist only success and revert the calendar on error. */
export function moveCalendarItem(schedule: Schedule, move: CalendarMove, now = new Date()): MoveResult {
  const start = move.startTime;
  if (!Number.isFinite(+start)) return { error: "Choose a valid date and time." };
  if (move.type === "fixed") {
    const event = schedule.events.find(event => event.id === move.id);
    if (!event) return { error: "This commitment no longer exists. Refresh the calendar." };
    const occurrence = expandEvents([event], midnight(move.occurrenceStart), nextDay(midnight(move.occurrenceStart)))
      .find(item => +item.startTime === +move.occurrenceStart);
    if (!occurrence) return { error: "This occurrence has changed. Refresh the calendar." };
    const end = new Date(+start + +occurrence.endTime - +occurrence.startTime);
    if (!event.repeatOn?.length) return { schedule: { ...schedule, needsReplan: true,
      events: schedule.events.map(item => item.id === event.id ? { ...item, startTime: start, endTime: end } : item) } };
    if (schedule.events.length >= 1000 || (event.excludedStarts?.length ?? 0) >= 2000)
      return { error: "The workspace has reached its commitment or recurrence exception limit. Remove unused commitments before moving this occurrence." };
    const replacement = { ...event, id: crypto.randomUUID(), startTime: start, endTime: end,
      repeatOn: undefined, excludedStarts: undefined, calendarImport: undefined };
    return { schedule: { ...schedule, needsReplan: true,
      events: [...schedule.events.map(item => item.id === event.id
        ? { ...item, excludedStarts: [...(item.excludedStarts ?? []), move.occurrenceStart.toISOString()] } : item), replacement] } };
  }
  const block = schedule.studyBlocks.find(block => block.id === move.id);
  if (!block) return { error: "This study session no longer exists. Refresh the calendar." };
  if (!canMoveStudy(block, now)) return { error: "Past, started, or finalized study sessions cannot be moved." };
  if (start <= now) return { error: "Study sessions must start in the future." };
  const end = new Date(+start + +block.endTime - +block.startTime);
  const task = schedule.tasks.find(task => task.id === block.taskId);
  if (!task || end > task.deadline) return { error: "The session must finish by the assignment deadline." };
  const minutes = (+end - +start) / 60000;
  const preferences = schedule.preferences;
  if (minutes > preferences.maxSessionTimeMinutes) return { error: "This session exceeds your maximum session length. Update your preferences first." };
  const from = midnight(start);
  from.setDate(from.getDate() - 1);
  for (let day = from; day < end; day = nextDay(day)) {
    const bed = clock(day, preferences.sleepHours.bedtime);
    let wake = clock(day, preferences.sleepHours.wakeUpTime);
    if (wake <= bed) wake = nextDay(wake);
    if (overlaps(start, end, bed, wake)) return { error: "The session overlaps your sleep hours." };
  }
  if (expandEvents(schedule.events, from, end).some(event => overlaps(start, end, event.startTime, event.endTime)))
    return { error: "The session overlaps a fixed commitment." };
  const others = schedule.studyBlocks.filter(item => item.id !== block.id);
  for (const other of others) {
    if (overlaps(start, end, other.startTime, other.endTime)) return { error: "The session overlaps another study session." };
    const pause = (other.status === "skipped" ? 0 : preferences.breakDurationMinutes) * 60000;
    if (+start < +other.endTime + pause && +end > +other.startTime - pause)
      return { error: `Leave at least ${preferences.breakDurationMinutes} minutes between study sessions.` };
  }
  for (let day = midnight(start); day < end; day = nextDay(day)) {
    const tomorrow = nextDay(day);
    const used = [...others.filter(item => item.status !== "skipped"), { startTime: start, endTime: end }]
      .reduce((total, item) => total + Math.max(0, Math.min(+tomorrow, +item.endTime) - Math.max(+day, +item.startTime)) / 60000, 0);
    if (used > preferences.maxStudyTimeMinutes) return { error: "The move exceeds your daily study limit." };
  }
  return { schedule: { ...schedule, studyBlocks: schedule.studyBlocks.map(item => item.id === block.id
    ? { ...item, startTime: start, endTime: end, manuallyMoved: true } : item) } };
}
