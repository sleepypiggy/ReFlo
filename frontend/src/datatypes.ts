/** JavaScript weekday numbering: Sunday = 0, Saturday = 6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TaskInput {
  id: string;
  name: string;
  estimatedTimeMinutes: number;
  remainingTimeMinutes?: number;
  /** Omit both times until the task is placed on the calendar. */
  startTime?: Date;
  endTime?: Date;
  deadline: Date;
  /** Percentage from 0 to 100. */
  gradeWeight: number;
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
}

export interface Preferences {
  /** Maximum total study time per day. */
  maxStudyTimeMinutes: number;
  /** Local 24-hour clock times in HH:mm format; may span midnight. */
  sleepHours: {
    bedtime: string;
    wakeUpTime: string;
  };
  breakDurationMinutes: number;
}

export interface Schedule {
  /** Local date marking the first day of the displayed week. */
  weekStart: Date;
  tasks: Task[];
  events: Event[];
  preferences: Preferences;
}
