import {
  Task,
  type Schedule,
  type Preferences,
  type StudyBlock,
} from "../datatypes";
import { duration, isPreserved, weekStart } from "./calendar";

export const defaultPreferences: Preferences = {
  maxStudyTimeMinutes: 240,
  maxSessionTimeMinutes: 90,
  breakDurationMinutes: 15,
  sleepHours: { bedtime: "23:00", wakeUpTime: "07:00" },
};

/** Authored sample timetable. No scheduling algorithm runs in the frontend. */
export function createDemo(now = new Date()): Schedule {
  const monday = weekStart(now);
  const at = (day: number, hour: number, minute = 0) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + day);
    date.setHours(hour, minute);
    return date;
  };
  const tasks = [
    new Task({
      id: "demo-cpsc",
      name: "CPSC 210 · Problem set 4",
      deadline: at(6, 23, 59),
      estimatedTimeMinutes: 360,
      remainingTimeMinutes: 270,
      gradeWeight: 15,
    }),
    new Task({
      id: "demo-math",
      name: "MATH 200 · Integration assignment",
      deadline: at(8, 17),
      estimatedTimeMinutes: 240,
      gradeWeight: 10,
    }),
    new Task({
      id: "demo-engl",
      name: "ENGL 110 · Critical response",
      deadline: at(10, 23, 59),
      estimatedTimeMinutes: 300,
      gradeWeight: 25,
    }),
  ];
  const fixed = (
    id: string,
    name: string,
    day: number,
    hour: number,
    minutes: number,
    repeatOn?: (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
  ) => ({
    id,
    name,
    startTime: at(day, hour),
    endTime: new Date(at(day, hour).getTime() + minutes * 60000),
    timeMinutes: minutes,
    remainingTimeMinutes: minutes,
    repeatOn,
  });
  const block = (
    id: string,
    taskId: string,
    day: number,
    hour: number,
    minutes: number,
    status: StudyBlock["status"] = "planned",
  ): StudyBlock => ({
    id,
    taskId,
    startTime: at(day, hour),
    endTime: new Date(at(day, hour).getTime() + minutes * 60000),
    status,
  });
  return {
    weekStart: monday,
    tasks,
    preferences: structuredClone(defaultPreferences),
    source: "demo",
    needsReplan: false,
    events: [
      fixed("lecture-cs", "CPSC 210 · Lecture", 0, 9, 60, [1, 3, 5]),
      fixed("lecture-math", "MATH 200 · Lecture", 1, 11, 90, [2, 4]),
      fixed("sports", "Intramural volleyball", 2, 16, 90, [3]),
      fixed("dinner", "Dinner", 0, 18, 60, [0, 1, 2, 3, 4, 5, 6]),
    ],
    studyBlocks: [
      block("sample-1", "demo-cpsc", 0, 11, 90, "completed"),
      block("sample-2", "demo-math", 1, 14, 90),
      block("sample-3", "demo-cpsc", 2, 11, 90),
      block("sample-4", "demo-engl", 3, 14, 90),
      block("sample-5", "demo-cpsc", 4, 11, 90),
      block("sample-6", "demo-cpsc", 5, 10, 90),
      block("sample-7", "demo-math", 6, 13, 90),
    ],
    warnings: [
      {
        taskId: "demo-engl",
        unscheduledMinutes: 210,
        reason:
          "Sample conflict: additional study time needs a slot before the deadline.",
      },
    ],
  };
}

export function emptySchedule(): Schedule {
  return {
    weekStart: weekStart(),
    tasks: [],
    events: [],
    preferences: structuredClone(defaultPreferences),
    studyBlocks: [],
    warnings: [],
    source: "backend",
    needsReplan: false,
  };
}

export function demoResult(schedule: Schedule, now: Date) {
  // Replay existing authored blocks, never manufacture a solution to new inputs.
  const studyBlocks = schedule.studyBlocks.filter(
    (block) =>
      isPreserved(block, now) ||
      schedule.tasks.some(
        (task) =>
          task.id === block.taskId &&
          task.remainingTimeMinutes > 0 &&
          block.endTime <= task.deadline,
      ),
  );
  const warnings = schedule.tasks.flatMap((task) => {
    const planned = studyBlocks
      .filter(
        (block) =>
          block.taskId === task.id &&
          block.status === "planned" &&
          !isPreserved(block, now),
      )
      .reduce((sum, block) => sum + duration(block), 0);
    const minutes = Math.max(0, task.remainingTimeMinutes - planned);
    return minutes
      ? [
          {
            taskId: task.id,
            unscheduledMinutes: minutes,
            reason:
              "Demo uses an authored timetable. New or unfinished work needs the backend scheduler.",
          },
        ]
      : [];
  });
  return { studyBlocks, warnings };
}
