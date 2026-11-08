import { Task, type AppMode, type Schedule } from "../datatypes";
import { createDemo, emptySchedule } from "./mockData";
import { isTopicColor } from "./topics";

export interface Workspace {
  mode: AppMode;
  demo: Schedule;
  backend: Schedule;
}
const KEY = "schedule-maker:v1";
export const initialWorkspace = (): Workspace => ({
  mode: "demo",
  demo: createDemo(),
  backend: emptySchedule(),
});

function revive(value: Schedule): Schedule {
  const date = (input: Date) => {
    if (!(input instanceof Date) && typeof input !== "string") throw new Error("Invalid saved date");
    if (typeof input === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input))
      throw new Error("Saved dates must include a timezone");
    const result = new Date(input);
    if (!Number.isFinite(result.getTime()))
      throw new Error("Invalid saved date");
    return result;
  };
  const positive = (number: number, zero = false) => {
    if (
      !Number.isFinite(number) ||
      !Number.isSafeInteger(number) ||
      number < (zero ? 0 : 1)
    )
      throw new Error("Invalid saved minutes");
  };
  if (
    !value ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.studyBlocks) ||
    !Array.isArray(value.warnings)
  )
    throw new Error("Invalid saved workspace");
  const preferences = value.preferences;
  const topics = value.topics ?? [];
  if (!Array.isArray(topics) || topics.some((topic) =>
    !topic || typeof topic.id !== "string" || !topic.id ||
    typeof topic.name !== "string" || !topic.name.trim() || topic.name.length > 80 ||
    !isTopicColor(topic.color)) || new Set(topics.map((topic) => topic.id)).size !== topics.length) {
    throw new Error("Invalid saved topics");
  }
  positive(preferences.maxStudyTimeMinutes);
  positive(preferences.maxSessionTimeMinutes);
  positive(preferences.breakDurationMinutes, true);
  for (const time of [preferences.sleepHours.bedtime, preferences.sleepHours.wakeUpTime])
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Invalid saved sleep time");
  const unique = (ids: string[]) => {
    if (ids.some(id => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length)
      throw new Error("Invalid or duplicate ID");
  };
  unique(value.tasks.map(task => task.id));
  unique(value.events.map(event => event.id));
  unique(value.studyBlocks.map(block => block.id));
  unique(value.warnings.map(warning => warning.taskId));
  if (value.tasks.length > 200 || value.events.length > 1000 || value.studyBlocks.length > 2000)
    throw new Error("Workspace exceeds supported limits");
  if (preferences.maxStudyTimeMinutes > 1440 || preferences.maxSessionTimeMinutes > 1440 ||
      preferences.breakDurationMinutes > 1440 || preferences.sleepHours.bedtime === preferences.sleepHours.wakeUpTime)
    throw new Error("Invalid study preferences");
  if (value.needsReplan !== undefined && typeof value.needsReplan !== "boolean")
    throw new Error("Invalid plan status");
  return {
    ...value,
    topics,
    needsReplan: value.needsReplan ?? false,
    weekStart: date(value.weekStart),
    tasks: value.tasks.map((task) => {
      positive(task.estimatedTimeMinutes);
      positive(task.remainingTimeMinutes, true);
      if (
        typeof task.id !== "string" ||
        typeof task.name !== "string" ||
        !task.name.trim() || !Number.isFinite(task.gradeWeight) || task.gradeWeight < 0 || task.gradeWeight > 100
      )
        throw new Error("Invalid saved assignment");
      if (task.color !== undefined && !isTopicColor(task.color)) throw new Error("Invalid saved assignment color");
      return new Task({
        ...task,
        topicId: topics.some((topic) => topic.id === task.topicId) ? task.topicId : undefined,
        deadline: date(task.deadline),
        startTime: task.startTime ? date(task.startTime) : undefined,
        endTime: task.endTime ? date(task.endTime) : undefined,
      });
    }),
    events: value.events.map((event) => {
      if (event.color !== undefined && !isTopicColor(event.color)) throw new Error("Invalid saved event color");
      const startTime = date(event.startTime), endTime = date(event.endTime);
      if (typeof event.name !== "string" || !event.name.trim() || endTime <= startTime ||
          (event.repeatOn !== undefined && (!Array.isArray(event.repeatOn) || event.repeatOn.some(day => !Number.isInteger(day) || day < 0 || day > 6))))
        throw new Error("Invalid saved event");
      positive(event.timeMinutes);
      positive(event.remainingTimeMinutes, true);
      return { ...event, startTime, endTime, topicId: topics.some((topic) => topic.id === event.topicId) ? event.topicId : undefined };
    }),
    studyBlocks: value.studyBlocks.map((block) => {
      if (
        !["planned", "completed", "unfinished", "skipped"].includes(block.status) ||
        !value.tasks.some((task) => task.id === block.taskId)
      )
        throw new Error("Invalid saved session");
      const startTime = date(block.startTime), endTime = date(block.endTime);
      if (endTime <= startTime || (block.locked !== undefined && typeof block.locked !== "boolean"))
        throw new Error("Invalid saved session");
      return { ...block, startTime, endTime };

    }),
    warnings: value.warnings.map(warning => {
      positive(warning.unscheduledMinutes, true);
      if (!value.tasks.some(task => task.id === warning.taskId) || typeof warning.reason !== "string")
        throw new Error("Invalid saved warning");
      return warning;
    }),
    skippedSessions: value.skippedSessions?.map(session => ({ ...session, startTime: date(session.startTime), endTime: date(session.endTime) })),
  };
}

export function loadWorkspace(): { workspace: Workspace; error?: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { workspace: initialWorkspace() };
    return { workspace: reviveWorkspace(JSON.parse(raw)) };
  } catch {
    return {
      workspace: initialWorkspace(),
      error:
        "Saved data could not be read. This visit starts with sample data. Check browser storage before saving changes.",
    };
  }
}

export function saveWorkspace(workspace: Workspace) {
  localStorage.setItem(KEY, JSON.stringify(workspace));
}

function reviveWorkspace(input: unknown): Workspace {
  if (!input || typeof input !== "object") throw new Error("Invalid workspace");
  const data = input as Workspace;
  if (data.mode !== "demo" && data.mode !== "backend") throw new Error("Invalid mode");
  return { mode: data.mode,
    demo: { ...revive(data.demo), source: "demo" },
    backend: { ...revive(data.backend), source: "backend" } };
}

export function exportBackup(workspace: Workspace): string {
  return JSON.stringify({ format: "schedule-maker-backup", version: 1, createdAt: new Date().toISOString(), workspace }, null, 2);
}

export function importBackup(text: string): Workspace {
  try {
    if (new TextEncoder().encode(text).length > 5_000_000) throw new Error("Too large");
    const data = JSON.parse(text);
    if (data?.format !== "schedule-maker-backup" || data?.version !== 1) throw new Error("Unsupported format");
    const workspace = reviveWorkspace(data.workspace);
    // Imported dates/plans may come from another timezone or an earlier day.
    return { ...workspace, demo: { ...workspace.demo, needsReplan: true }, backend: { ...workspace.backend, needsReplan: true } };
  } catch {
    throw new Error("Invalid backup. Use a Schedule Maker version 1 JSON backup under 5 MB. Your current data is unchanged.");
  }
}
