import type { Event, StudyBlock } from "@/datatypes";

export function weekStart(date = new Date()) {
  const result = new Date(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

export function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function duration(block: Pick<StudyBlock, "startTime" | "endTime">) {
  return Math.round(
    (block.endTime.getTime() - block.startTime.getTime()) / 60000,
  );
}

export const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;
export const dateLabel = (date: Date) =>
  date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export const isPreserved = (block: StudyBlock, now: Date) =>
  block.status !== "planned" || !!block.locked || block.startTime <= now;

/** Expand fixed commitments only. This never schedules assignment work. */
export function expandEvents(events: Event[], start: Date, end: Date) {
  return events.flatMap((event) => {
    if (!event.repeatOn?.length) return [{ ...event, instanceId: event.id }];
    const occurrences = [];
    const firstDay = new Date(start);
    firstDay.setDate(firstDay.getDate() - 1);
    for (const day = firstDay; day < end; day.setDate(day.getDate() + 1)) {
      if (!event.repeatOn.includes(day.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6))
        continue;
      const from = new Date(day);
      from.setHours(
        event.startTime.getHours(),
        event.startTime.getMinutes(),
        0,
        0,
      );
      if (from < event.startTime) continue;
      const to = new Date(from);
      to.setHours(event.endTime.getHours(), event.endTime.getMinutes(), 0, 0);
      if (to <= from) to.setDate(to.getDate() + 1);
      occurrences.push({
        ...event,
        instanceId: `${event.id}-${from.toISOString()}`,
        startTime: from,
        endTime: to,
      });
    }
    return occurrences;
  });
}
