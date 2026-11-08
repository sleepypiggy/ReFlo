import type { Schedule, StudyBlock, SchedulingWarning } from "@/datatypes";
import { expandEvents, isPreserved } from "./calendar";

/** Wire convention: UTC ISO 8601 with explicit Z. Recurrence/sleep use local wall
 * times in the supplied IANA timezone; backend must account for DST per date. */
export function toScheduleRequest(schedule: Schedule, now = new Date()) {
  return {
    contract_version: 1,
    current_time: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks: schedule.tasks.map((task) => ({
      id: task.id,
      title: task.name,
      deadline: task.deadline.toISOString(),
      estimated_minutes: task.estimatedTimeMinutes,
      remaining_minutes: task.remainingTimeMinutes,
      grade_weight: task.gradeWeight,
    })),
    events: schedule.events.map((event) => ({
      id: event.id,
      title: event.name,
      start: event.startTime.toISOString(),
      end: event.endTime.toISOString(),
      repeat_on: event.repeatOn ?? [],
    })),
    preferences: {
      wake_up_time: schedule.preferences.sleepHours.wakeUpTime,
      bedtime: schedule.preferences.sleepHours.bedtime,
      max_daily_study_minutes: schedule.preferences.maxStudyTimeMinutes,
      max_session_minutes: schedule.preferences.maxSessionTimeMinutes,
      break_minutes: schedule.preferences.breakDurationMinutes,
      spread_assignments: schedule.preferences.spreadAssignments ?? true,
    },
    locked_blocks: schedule.studyBlocks
      .filter((block) => isPreserved(block, now))
      .map((block) => ({
        id: block.id,
        task_id: block.taskId,
        start: block.startTime.toISOString(),
        end: block.endTime.toISOString(),
        status: block.status,
        locked: true,
      })),
  };
}

export type ScheduleRequest = ReturnType<typeof toScheduleRequest>;
export interface ScheduleResponse {
  study_blocks: {
    id: string;
    task_id: string;
    start: string;
    end: string;
    status: "planned";
  }[];
  unscheduled: { task_id: string; minutes: number; reason: string }[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object")
    throw new Error("Invalid schedule response.");
  return value as Record<string, unknown>;
}
function datetime(value: unknown) {
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("API dates must include a timezone offset.");
  return new Date(value);
}

/** Reject malformed responses before touching the current schedule. */
export function fromScheduleResponse(
  value: unknown,
  schedule: Schedule,
  now: Date,
): { studyBlocks: StudyBlock[]; warnings: SchedulingWarning[] } {
  const data = record(value);
  if (!Array.isArray(data.study_blocks) || !Array.isArray(data.unscheduled))
    throw new Error(
      "API response must include study_blocks and unscheduled arrays.",
    );
  const preserved = schedule.studyBlocks.filter((block) =>
    isPreserved(block, now),
  );
  const ids = new Set(preserved.map((block) => block.id));
  const blocks: StudyBlock[] = data.study_blocks.map((value) => {
    const item = record(value);
    const task = schedule.tasks.find((task) => task.id === item.task_id);
    if (
      !task ||
      typeof item.id !== "string" ||
      !item.id ||
      ids.has(item.id) ||
      item.status !== "planned"
    )
      throw new Error(
        "API returned an invalid task, status, or duplicate session ID.",
      );
    ids.add(item.id);
    const block: StudyBlock = {
      id: item.id,
      taskId: task.id,
      startTime: datetime(item.start),
      endTime: datetime(item.end),
      status: "planned",
    };
    if (
      block.startTime < now ||
      block.endTime <= block.startTime ||
      block.endTime > task.deadline
    )
      throw new Error("API returned a session outside its valid time window.");
    return block;
  });
  const all = [...preserved, ...blocks];
  for (const block of blocks) {
    if (
      all.some(
        (other) =>
          other.id !== block.id &&
          other.startTime < block.endTime &&
          other.endTime > block.startTime,
      )
    )
      throw new Error("API returned overlapping study sessions.");
    const from = new Date(block.startTime);
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    if (
      expandEvents(schedule.events, from, block.endTime).some(
        (event) =>
          event.startTime < block.endTime && event.endTime > block.startTime,
      )
    )
      throw new Error(
        "API returned study time overlapping a fixed commitment.",
      );
  }
  const warnings = data.unscheduled.map((value) => {
    const item = record(value);
    if (
      !schedule.tasks.some((task) => task.id === item.task_id) ||
      typeof item.minutes !== "number" ||
      !Number.isInteger(item.minutes) ||
      item.minutes < 0 ||
      typeof item.reason !== "string"
    )
      throw new Error("API returned an invalid unscheduled-work warning.");
    return {
      taskId: item.task_id as string,
      unscheduledMinutes: item.minutes,
      reason: item.reason,
    };
  });
  return { studyBlocks: all, warnings };
}
