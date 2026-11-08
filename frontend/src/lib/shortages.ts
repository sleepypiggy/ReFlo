import type { Schedule, StudyBlock } from "../datatypes";

type Plan = Pick<Schedule, "studyBlocks" | "warnings">;
export type Suggestion = { taskId: string; message: string };
export type SuggestionResult = {
  key: string; checkedAt: Date; suggestions: Suggestion[]; stale: boolean;
};
export type ScheduleRunner = (schedule: Schedule, now: Date, signal?: AbortSignal) => Promise<Plan>;

export function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    rest ? `${rest} ${rest === 1 ? "minute" : "minutes"}` : ""].filter(Boolean).join(" ") || "0 minutes";
}

/** Remaining work already excludes completed work. Count only future planned minutes. */
export function scheduledMinutes(blocks: StudyBlock[], taskId: string, now: Date) {
  return blocks.filter(block => block.taskId === taskId && block.status === "planned")
    .reduce((sum, block) => sum + Math.max(0, Math.floor((+block.endTime - Math.max(+block.startTime, +now)) / 60000)), 0);
}

export function shortageRows(schedule: Schedule, now: Date) {
  return schedule.tasks.map(task => {
    const scheduled = scheduledMinutes(schedule.studyBlocks, task.id, now);
    const missing = schedule.warnings.filter(warning => warning.taskId === task.id)
      .reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
    return { task, scheduled, missing };
  });
}

export function shortagesAreStale(schedule: Schedule, now: Date) {
  return !!schedule.needsReplan || shortageRows(schedule, now).some(({ task, scheduled, missing }) =>
    scheduled + missing !== task.remainingTimeMinutes || (missing > 0 && task.deadline <= now));
}

// Includes placements/statuses as well as inputs: edits invalidate in-flight and displayed results.
export const shortageKey = (schedule: Schedule) => JSON.stringify({ tasks: schedule.tasks,
  events: schedule.events, preferences: schedule.preferences, studyBlocks: schedule.studyBlocks,
  warnings: schedule.warnings, needsReplan: schedule.needsReplan, source: schedule.source });

export function suggestionIsCurrent(result: SuggestionResult, schedule: Schedule, now: Date) {
  return result.key === shortageKey(schedule) && !shortagesAreStale(schedule, now) &&
    +now - +result.checkedAt < 5 * 60000 && !schedule.studyBlocks.some(block =>
      block.status === "planned" && block.startTime > result.checkedAt && block.startTime <= now);
}

export function candidateLimits(current: number) {
  return [...new Set([30, 60, 120].map(extra => Math.min(1440, current + extra)))].filter(limit => limit > current);
}

function verifyAccounting(schedule: Schedule, plan: Plan, now: Date) {
  if (shortageRows({ ...schedule, ...plan }, now).some(({ task, scheduled, missing }) =>
    scheduled + missing !== task.remainingTimeMinutes))
    throw new Error("The suggestion response has inconsistent work totals.");
}

function dailyTotals(blocks: StudyBlock[], taskId: string, now: Date) {
  const totals = new Map<string, number>();
  for (const block of blocks.filter(block => block.taskId === taskId && block.status === "planned")) {
    let start = Math.max(+block.startTime, +now);
    while (start < +block.endTime) {
      const day = new Date(start), end = new Date(start);
      end.setHours(24, 0, 0, 0);
      const key = day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      const until = Math.min(+end, +block.endTime);
      totals.set(key, (totals.get(key) ?? 0) + Math.floor((until - start) / 60000));
      start = until;
    }
  }
  return totals;
}

export function describeAdjustment(schedule: Schedule, candidate: Plan, taskId: string, limit: number, now: Date) {
  const task = schedule.tasks.find(task => task.id === taskId)!;
  const before = scheduledMinutes(schedule.studyBlocks, taskId, now);
  const after = scheduledMinutes(candidate.studyBlocks, taskId, now);
  const remains = task.remainingTimeMinutes - after;
  const totalMissing = schedule.tasks.reduce((sum, task) => sum + task.remainingTimeMinutes -
    scheduledMinutes(candidate.studyBlocks, task.id, now), 0);
  const oldDays = dailyTotals(schedule.studyBlocks, taskId, now);
  const newDays = dailyTotals(candidate.studyBlocks, taskId, now);
  const days = [...new Set([...oldDays.keys(), ...newDays.keys()])].map(day => ({ day,
    delta: (newDays.get(day) ?? 0) - (oldDays.get(day) ?? 0) })).filter(item => item.delta !== 0);
  const changes = days.slice(0, 4).map(({ day, delta }) =>
    `${delta > 0 ? "adding" : "removing"} ${minutesLabel(Math.abs(delta))} on ${day}`).join(", ");
  const losses = schedule.tasks.filter(other => other.id !== taskId).flatMap(other => {
    const lost = scheduledMinutes(schedule.studyBlocks, other.id, now) - scheduledMinutes(candidate.studyBlocks, other.id, now);
    return lost > 0 ? [`${other.name} loses ${minutesLabel(lost)}`] : [];
  });
  return `A higher daily limit allows the scheduler to fit ${minutesLabel(after - before)} more for ${task.name}. ` +
    `Increasing it from ${minutesLabel(schedule.preferences.maxStudyTimeMinutes)} to ${minutesLabel(limit)} ` +
    `leaves ${minutesLabel(remains)} unscheduled for this assignment` +
    (changes ? `, ${changes}${days.length > 4 ? `, with changes on ${days.length - 4} other dates` : ""}` : "") + ". " +
    (totalMissing === 0 ? "All remaining work fits." : `${minutesLabel(totalMissing)} remains unscheduled across all assignments.`) +
    (losses.length ? ` Tradeoff: ${losses.join("; ")}.` : "");
}

/** Four requests at most (baseline + three candidates), one shared 12-second budget.
 * Never publishes a plan. The runner uses the ordinary scheduling adapter/validation. */
export async function checkShortageSuggestions(schedule: Schedule, run: ScheduleRunner, now = new Date(), signal?: AbortSignal): Promise<SuggestionResult> {
  const result: SuggestionResult = { key: shortageKey(schedule), checkedAt: now, suggestions: [], stale: false };
  if (schedule.source === "demo") return result;
  if (shortagesAreStale(schedule, now)) return { ...result, stale: true };
  const bounded = AbortSignal.timeout(12000);
  const combined = signal ? AbortSignal.any([bounded, signal]) : bounded;
  const baseline = await run(schedule, now, combined);
  verifyAccounting(schedule, baseline, now);
  // Time passing or a changed backend can make a saved warning obsolete.
  if (schedule.tasks.some(task => scheduledMinutes(baseline.studyBlocks, task.id, now) !==
    scheduledMinutes(schedule.studyBlocks, task.id, now))) return { ...result, stale: true };
  const affected = shortageRows(schedule, now).filter(row => row.missing > 0);
  const best = new Map<string, { plan: Plan; limit: number; gain: number; loss: number }>();
  for (const limit of candidateLimits(schedule.preferences.maxStudyTimeMinutes)) {
    combined.throwIfAborted();
    const candidate = await run({ ...schedule, preferences: { ...schedule.preferences, maxStudyTimeMinutes: limit } }, now, combined);
    verifyAccounting(schedule, candidate, now);
    for (const { task, scheduled } of affected) {
      const gain = scheduledMinutes(candidate.studyBlocks, task.id, now) - scheduled;
      const loss = schedule.tasks.reduce((sum, other) => sum + Math.max(0,
        scheduledMinutes(schedule.studyBlocks, other.id, now) - scheduledMinutes(candidate.studyBlocks, other.id, now)), 0);
      const previous = best.get(task.id);
      if (gain > 0 && (!previous || loss < previous.loss || (loss === previous.loss && gain > previous.gain)))
        best.set(task.id, { plan: candidate, limit, gain, loss });
    }
  }
  result.suggestions = affected.map(({ task }) => {
    const choice = best.get(task.id);
    return { taskId: task.id, message: choice ? describeAdjustment(schedule, choice.plan, task.id, choice.limit, now) :
      "No tested daily-limit increase resolved the shortage." };
  });
  return result;
}
