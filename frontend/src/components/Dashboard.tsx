"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Clock3,
  FlaskConical,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Plus,
  Radio,
  Settings2,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";
import type { AppMode, Event, Schedule, Task } from "@/datatypes";
import { checkHealth, generateSchedule } from "@/lib/api";
import { duration, hours } from "@/lib/calendar";
import { demoResult } from "@/lib/mockData";
import { loadWorkspace, saveWorkspace, type Workspace } from "@/lib/storage";
import AssignmentForm from "./AssignmentForm";
import AssignmentList from "./AssignmentList";
import EventForm from "./EventForm";
import Modal from "./Modal";
import PreferencesPanel from "./PreferencesPanel";
import StudySessionModal from "./StudySessionModal";
import WeeklyCalendar from "./WeeklyCalendar";
import TimeShortagePanel from "./TimeShortagePanel";

type Dialog =
  | { type: "assignment"; task?: Task }
  | { type: "event"; event?: Event }
  | { type: "preferences" }
  | { type: "session"; id: string }
  | { type: "delete"; task: Task };

export default function Dashboard() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [persist, setPersist] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [section, setSection] = useState<"calendar" | "assignments">(
    "calendar",
  );
  const [busy, setBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [health, setHealth] = useState("Not checked");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      const result = loadWorkspace();
      setWorkspace(result.workspace);
      setPersist(!result.error);
      if (result.error) setError(result.error);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!workspace || !persist) return;
    try {
      saveWorkspace(workspace);
    } catch {
      const timer = setTimeout(
        () =>
          setError(
            "Browser storage is unavailable or full. Changes are only saved for this visit.",
          ),
        0,
      );
      return () => clearTimeout(timer);
    }
  }, [workspace, persist]);
  if (!workspace)
    return (
      <main className="loading">
        <LoaderCircle className="spin" />
        Loading your workspace…
      </main>
    );
  const mode = workspace.mode,
    schedule = workspace[mode];
  const apply = (next: Schedule) => {
    setPersist(true);
    setWorkspace((current) =>
      current ? { ...current, [mode]: next } : current,
    );
  };
  const changed = (next: Schedule) => {
    apply(next);
    setDialog(null);
    setNotice("Saved. Generate a schedule to account for these changes.");
    setError("");
  };
  async function scheduleWork(next = schedule) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const now = new Date();
      const result =
        mode === "demo"
          ? demoResult(next, now)
          : await generateSchedule(next, now);
      apply({ ...next, ...result, source: mode });
      setNotice(
        mode === "demo"
          ? "Mock timetable refreshed. Demo replays authored sessions; it does not schedule new work."
          : "Your study schedule has been updated.",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Scheduling failed. Your existing schedule is preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function complete(id: string) {
    const block = schedule.studyBlocks.find((block) => block.id === id);
    if (!block || block.status !== "planned" || block.locked) return;
    apply({
      ...schedule,
      studyBlocks: schedule.studyBlocks.map((item) =>
        item.id === id ? { ...item, status: "completed", locked: true } : item,
      ),
      tasks: schedule.tasks.map((task) =>
        task.id === block.taskId
          ? {
            ...task,
            remainingTimeMinutes: Math.max(
              0,
              task.remainingTimeMinutes - duration(block),
            ),
          }
          : task,
      ),
    });
    setDialog(null);
    setNotice(
      "Session completed. Progress saved. Regenerate to update future study time and warnings.",
    );
  }
  async function unfinished(id: string, remaining: number) {
    if (!Number.isInteger(remaining) || remaining < 0) return;
    const block = schedule.studyBlocks.find((block) => block.id === id);
    if (!block || block.status !== "planned" || block.locked) return;
    const next: Schedule = {
      ...schedule,
      tasks: schedule.tasks.map((task) =>
        task.id === block.taskId
          ? { ...task, remainingTimeMinutes: remaining }
          : task,
      ),
      studyBlocks: schedule.studyBlocks.map((item) =>
        item.id === id ? { ...item, status: "unfinished", locked: true } : item,
      ),
    };
    apply(next);
    setDialog(null);
    await scheduleWork(next);
  }
  function switchMode(next: AppMode) {
    setWorkspace({ ...workspace!, mode: next });
    setPersist(true);
    setNotice("");
    setError("");
    setDialog(null);
  }
  const remaining = schedule.tasks.reduce(
    (sum, task) => sum + task.remainingTimeMinutes,
    0,
  );
  const completed = schedule.studyBlocks.filter(
    (block) => block.status === "completed",
  ).length;
  const planned = schedule.studyBlocks
    .filter((block) => block.status === "planned")
    .reduce((sum, block) => sum + duration(block), 0);
  const selected =
    dialog?.type === "session"
      ? schedule.studyBlocks.find((block) => block.id === dialog.id)
      : undefined;
  const selectedTask =
    selected && schedule.tasks.find((task) => task.id === selected.taskId);
  const list = (
    <AssignmentList
      tasks={schedule.tasks}
      warnings={schedule.warnings}
      onAdd={() => setDialog({ type: "assignment" })}
      onEdit={(task) => setDialog({ type: "assignment", task })}
      onDelete={(task) => setDialog({ type: "delete", task })}
    />
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <fieldset className="app-guard" disabled={busy}>
        <div className="app-shell">
          <aside className="sidebar">
            <Link className="brand" href="/" aria-label="Schedule Maker home">
              <span className="brand-icon">
                <Layers3 size={23} />
              </span>
              <span>
                Schedule<span className="brand-light">Maker</span>
              </span>
            </Link>
            <div className="workspace-label">STUDENT WORKSPACE</div>
            <nav aria-label="Main navigation">
              <button
                className={
                  section === "calendar" ? "nav-item active" : "nav-item"
                }
                onClick={() => setSection("calendar")}
              >
                <CalendarDays size={19} />
                Calendar
              </button>
              <button
                className={
                  section === "assignments" ? "nav-item active" : "nav-item"
                }
                onClick={() => setSection("assignments")}
              >
                <BookOpen size={19} />
                Assignments
                <span className="nav-count">{schedule.tasks.length}</span>
              </button>
              <button
                className="nav-item"
                onClick={() => setDialog({ type: "preferences" })}
              >
                <Settings2 size={19} />
                Preferences
              </button>
            </nav>
            <div className="sidebar-actions">
              <button
                className="button"
                onClick={() => setDialog({ type: "assignment" })}
              >
                <Plus size={17} />
                Add Assignment
              </button>
              <button
                className="button"
                onClick={() => setDialog({ type: "event" })}
              >
                <Plus size={17} />
                Add Event
              </button>
              <button
                className="button primary"
                onClick={() => void scheduleWork()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
                Generate Schedule
              </button>
            </div>
            <div className="sidebar-bottom">
              <div className="rest-note">
                <GraduationCap size={23} />
                <h3>Make time for life.</h3>
                <p>Your study plan should work around you.</p>
                <button onClick={() => setDialog({ type: "preferences" })}>
                  Set your preferences <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="student">
                <span className="avatar">S</span>
                <div>
                  <strong>Student workspace</strong>
                  <span>Saved on this device</span>
                </div>
                <span className="saved-dot" />
              </div>
            </div>
          </aside>
          <div className="dashboard">
            <header className="topbar">
              <div className="breadcrumb">
                Workspace <span>/</span>{" "}
                <strong>
                  {section === "calendar" ? "Calendar" : "Assignments"}
                </strong>
              </div>
              <div className="mode-control">
                <FlaskConical size={15} />
                <label htmlFor="mode">Data source</label>
                <select
                  id="mode"
                  value={mode}
                  onChange={(event) =>
                    switchMode(event.target.value as AppMode)
                  }
                >
                  <option value="demo">Demo mode</option>
                  <option value="backend">Real backend</option>
                </select>
              </div>
            </header>
            <main id="main" className="main-content">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    A LITTLE STRUCTURE. MORE ROOM TO BREATHE.
                  </div>
                  <h1>
                    {section === "calendar"
                      ? "Your week, with a plan."
                      : "Your assignments."}
                  </h1>
                  <p>Keep your commitments. Find time for what&apos;s due.</p>
                </div>
                <span
                  className={`source-badge ${mode === "backend" ? "real" : ""}`}
                >
                  {mode === "demo" ? (
                    <FlaskConical size={15} />
                  ) : (
                    <Radio size={15} />
                  )}
                  {mode === "demo"
                    ? "Mock data · demo workspace"
                    : "Backend workspace"}
                </span>
              </div>
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-icon purple">
                    <BookOpen size={20} />
                  </span>
                  <div>
                    <span>Active assignments</span>
                    <strong>
                      {
                        schedule.tasks.filter(
                          (task) => task.remainingTimeMinutes > 0,
                        ).length
                      }
                      <small> to work on</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon green">
                    <Clock3 size={20} />
                  </span>
                  <div>
                    <span>Planned study time</span>
                    <strong>
                      {hours(planned)}
                      <small> on your calendar</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon blue">
                    <CheckCheck size={20} />
                  </span>
                  <div>
                    <span>Completed sessions</span>
                    <strong>
                      {completed}
                      <small> progress adds up</small>
                    </strong>
                  </div>
                </div>
              </div>
              <div className="status-area" aria-live="polite">
                {busy && (
                  <div className="info-banner">
                    <LoaderCircle className="spin" size={16} />
                    Updating your schedule…
                  </div>
                )}
                {notice && <div className="info-banner">{notice}</div>}
                {error && (
                  <div className="error-banner" role="alert">
                    <AlertTriangle size={17} />
                    {error}
                  </div>
                )}
              </div>
              {mode === "demo" && (
                <div className="demo-banner">
                  <FlaskConical size={17} />
                  <p>
                    <strong>You&apos;re exploring a sample week.</strong>{" "}
                    Sessions are mock data. Switch to the real backend for your
                    own schedule.
                  </p>
                </div>
              )}
              {schedule.warnings.length > 0 && (
                <TimeShortagePanel
                  schedule={schedule}
                  demo={mode === "demo"}
                />
              )}
              <div
                className={
                  section === "calendar" ? "work-grid" : "assignment-view"
                }
              >
                {section === "calendar" ? (
                  <>
                    <WeeklyCalendar
                      events={schedule.events}
                      tasks={schedule.tasks}
                      studyBlocks={schedule.studyBlocks}
                      onStudyClick={(id) => {
                        if (!busy) setDialog({ type: "session", id });
                      }}
                      onEventClick={(id) =>
                        !busy &&
                        setDialog({
                          type: "event",
                          event: schedule.events.find(
                            (event) => event.id === id,
                          ),
                        })
                      }
                    />
                    <aside className="assignment-panel">
                      {list}
                      <div className="remaining-note">
                        <Clock3 size={16} />
                        <span>
                          <strong>{hours(remaining)}</strong> of assignment work
                          remaining
                        </span>
                      </div>
                    </aside>
                  </>
                ) : (
                  list
                )}
              </div>
              <footer className="dashboard-footer">
                <span>
                  Built around your day.{" "}
                  {schedule.preferences.sleepHours.wakeUpTime} wake-up ·{" "}
                  {schedule.preferences.sleepHours.bedtime} bedtime
                </span>
                <button
                  className="health-button"
                  disabled={healthBusy}
                  onClick={async () => {
                    setHealthBusy(true);
                    try {
                      await checkHealth();
                      setHealth("Connected");
                    } catch (error) {
                      setHealth("Unavailable");
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Health check failed.",
                      );
                    } finally {
                      setHealthBusy(false);
                    }
                  }}
                >
                  <Wifi size={14} />
                  {healthBusy ? "Checking…" : `Test backend · ${health}`}
                </button>
              </footer>
            </main>
          </div>
        </div>
      </fieldset>
      {dialog && (
        <Modal
          title={
            dialog.type === "assignment"
              ? dialog.task
                ? "Edit assignment"
                : "Add assignment"
              : dialog.type === "event"
                ? dialog.event
                  ? "Edit commitment"
                  : "Add commitment"
                : dialog.type === "preferences"
                  ? "Study preferences"
                  : dialog.type === "delete"
                    ? "Delete assignment?"
                    : "Study session"
          }
          onClose={() => setDialog(null)}
        >
          {dialog.type === "assignment" && (
            <AssignmentForm
              task={dialog.task}
              onSave={(task) =>
                changed({
                  ...schedule,
                  tasks: schedule.tasks.some((item) => item.id === task.id)
                    ? schedule.tasks.map((item) =>
                      item.id === task.id ? task : item,
                    )
                    : [...schedule.tasks, task],
                  warnings: schedule.warnings.filter(
                    (warning) => warning.taskId !== task.id,
                  ),
                })
              }
            />
          )}
          {dialog.type === "event" && (
            <>
              <EventForm
                event={dialog.event}
                onSave={(event) =>
                  changed({
                    ...schedule,
                    events: schedule.events.some((item) => item.id === event.id)
                      ? schedule.events.map((item) =>
                        item.id === event.id ? event : item,
                      )
                      : [...schedule.events, event],
                  })
                }
              />
              {dialog.event && (
                <button
                  className="button danger event-delete"
                  onClick={() =>
                    changed({
                      ...schedule,
                      events: schedule.events.filter(
                        (item) => item.id !== dialog.event!.id,
                      ),
                    })
                  }
                >
                  <Trash2 size={16} />
                  Delete commitment
                </button>
              )}
            </>
          )}
          {dialog.type === "preferences" && (
            <PreferencesPanel
              preferences={schedule.preferences}
              onSave={(preferences) => changed({ ...schedule, preferences })}
            />
          )}
          {dialog.type === "session" && selected && selectedTask && (
            <StudySessionModal
              block={selected}
              task={selectedTask}
              busy={busy}
              onComplete={() => complete(selected.id)}
              onUnfinished={(minutes) => void unfinished(selected.id, minutes)}
            />
          )}
          {dialog.type === "delete" && (
            <div className="form-stack">
              <p>
                Delete <strong>{dialog.task.name}</strong> and all its study
                sessions, including history? This cannot be undone.
              </p>
              <button
                className="button danger"
                onClick={() =>
                  changed({
                    ...schedule,
                    tasks: schedule.tasks.filter(
                      (task) => task.id !== dialog.task.id,
                    ),
                    studyBlocks: schedule.studyBlocks.filter(
                      (block) => block.taskId !== dialog.task.id,
                    ),
                    warnings: schedule.warnings.filter(
                      (warning) => warning.taskId !== dialog.task.id,
                    ),
                  })
                }
              >
                Delete assignment and sessions
              </button>
              <button className="button" onClick={() => setDialog(null)}>
                Keep assignment
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
