/** JavaScript weekday numbering: Sunday = 0, Saturday = 6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TopicColor = "blue" | "green" | "gold" | "purple" | "rose" | `#${string}`;

export interface Topic {
  id: string;
  name: string;
  color: TopicColor;
}

export interface TaskInput {
  id: string;
  name: string;
  estimatedTimeMinutes: number;
  remainingTimeMinutes?: number;
  /** Legacy metadata only; independent StudyBlocks define the study schedule. */
  startTime?: Date;
  endTime?: Date;
  deadline: Date;
  /** Percentage from 0 to 100. */
  gradeWeight: number;
  topicId?: string;
  color?: TopicColor;
}

export class Task {
  id: string;
  name: string;
  estimatedTimeMinutes: number;
  remainingTimeMinutes: number;
  startTime?: Date;
  endTime?: Date;
  deadline: Date;
  gradeWeight: number;
  topicId?: string;
  color?: TopicColor;

  constructor(input: TaskInput) {
    this.id = input.id;
    this.name = input.name;
    this.estimatedTimeMinutes = input.estimatedTimeMinutes;
    this.remainingTimeMinutes =
      input.remainingTimeMinutes ?? input.estimatedTimeMinutes;
    this.startTime = input.startTime;
    this.endTime = input.endTime;
    this.deadline = input.deadline;
    this.gradeWeight = input.gradeWeight;
    this.topicId = input.topicId;
    this.color = input.color;
  }
}

/** A fixed commitment, such as a lecture or social activity. */
export interface Event {
  id: string;
  name: string;
  timeMinutes: number;
  startTime: Date;
  endTime: Date;
  remainingTimeMinutes: number;
  /** When set, repeat weekly on these days at the original local times. */
  repeatOn?: Weekday[];
  /** Original UTC starts omitted from this weekly series after occurrence moves. */
  excludedStarts?: string[];
  /** Imported occurrences are finite UTC instants, never local repeatOn rules. */
  calendarImport?: { uid: string; recurrenceId?: string; timezone: string };
  topicId?: string;
  color?: TopicColor;
}

export interface Preferences {
  /** Maximum total study time per day. */
  maxStudyTimeMinutes: number;
  maxSessionTimeMinutes: number;
  /** Local 24-hour clock times in HH:mm format; may span midnight. */
  sleepHours: {
    bedtime: string;
    wakeUpTime: string;
  };
  breakDurationMinutes: number;
  spreadAssignments?: boolean;
}

/** A skipped calendar entry retained after its task becomes unscheduled. */
export interface SkippedSession {
  taskId: string;
  taskName: string;
  startTime: Date;
  endTime: Date;
}

export interface Schedule {
  /** Local date marking the first day of the displayed week. */
  weekStart: Date;
  tasks: Task[];
  /** Shared class/topic colors; older saved schedules may omit this list. */
  topics?: Topic[];
  events: Event[];
  preferences: Preferences;
  skippedSessions?: SkippedSession[];
  studyBlocks: StudyBlock[];
  warnings: SchedulingWarning[];
  source: "demo" | "backend";
  needsReplan?: boolean;
}

/** An independent session, never the assignment's overall start/end. */
export interface StudyBlock {
  id: string;
  taskId: string;
  startTime: Date;
  endTime: Date;
  status: "planned" | "completed" | "unfinished" | "skipped";
  locked?: boolean;
  /** Reserve this placement during regeneration without finalizing progress. */
  manuallyMoved?: boolean;
}

export interface SchedulingWarning {
  taskId: string;
  unscheduledMinutes: number;
  reason: string;
}

export type AppMode = "demo" | "backend";
