import { Task, type AppMode, type Schedule } from "@/datatypes";
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
    const result = new Date(input);
    if (!Number.isFinite(result.getTime()))
      throw new Error("Invalid saved date");
    return result;
  };
  const positive = (number: number, zero = false) => {
    if (
      !Number.isFinite(number) ||
      !Number.isInteger(number) ||
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
  for (const time of Object.values(preferences.sleepHours))
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Invalid saved sleep time");
  return {
    ...value,
    topics,
    weekStart: date(value.weekStart),
    tasks: value.tasks.map((task) => {
      positive(task.estimatedTimeMinutes);
      positive(task.remainingTimeMinutes, true);
      if (
        typeof task.id !== "string" ||
        typeof task.name !== "string" ||
        !Number.isFinite(task.gradeWeight)
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
      return {
      ...event,
      topicId: topics.some((topic) => topic.id === event.topicId) ? event.topicId : undefined,
      startTime: date(event.startTime),
      endTime: date(event.endTime),
    };
    }),
    studyBlocks: value.studyBlocks.map((block) => {
      if (
        !["planned", "completed", "unfinished"].includes(block.status) ||
        !value.tasks.some((task) => task.id === block.taskId)
      )
        throw new Error("Invalid saved session");
      return {
        ...block,
        startTime: date(block.startTime),
        endTime: date(block.endTime),
      };
    }),
  };
}

export function loadWorkspace(): { workspace: Workspace; error?: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { workspace: initialWorkspace() };
    const data = JSON.parse(raw) as Workspace;
    if (data.mode !== "demo" && data.mode !== "backend")
      throw new Error("Invalid mode");
    return {
      workspace: {
        mode: data.mode,
        demo: { ...revive(data.demo), source: "demo" },
        backend: { ...revive(data.backend), source: "backend" },
      },
    };
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
