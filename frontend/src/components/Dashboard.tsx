"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCheck,
  Clock3,
  FlaskConical,
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
import { loadWorkspace, saveWorkspace, exportBackup, importBackup, type Workspace } from "@/lib/storage";
import { hasStudyConflict, planChangeDetails, planChanges, releaseConflictingPlacements, upcomingMinutes } from "@/lib/plan";
import { moveCalendarItem, type CalendarMove } from "@/lib/calendarMoves";
import AssignmentForm from "./AssignmentForm";
import AssignmentList from "./AssignmentList";
import EventForm from "./EventForm";
import Modal from "./Modal";
import PreferencesPanel from "./PreferencesPanel";
import StudySessionModal from "./StudySessionModal";
import WeeklyCalendar from "./WeeklyCalendar";
import TimeShortagePanel from "./TimeShortagePanel";
import ThemeToggle from "./ThemeToggle";
import AssistantPanel from "./AssistantPanel";
import CalendarFiles from "./CalendarFiles";
import PlanReview from "./PlanReview";

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
  const [undo, setUndo] = useState<{ mode: AppMode; schedule: Schedule } | null>(null);
  const [review, setReview] = useState<{ mode: AppMode; before: Schedule; after: Schedule; at: Date } | null>(null);
  const [restore, setRestore] = useState<Workspace | null>(null);
  const [, refreshClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refreshClock(value => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
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
    setReview(null);
    setPersist(true);
    setWorkspace((current) =>
      current ? { ...current, [mode]: next } : current,
    );
  };
  const changed = (next: Schedule) => {
    apply({ ...next, needsReplan: true });
    setUndo(null);
    setDialog(null);
    setNotice("Saved. Generate a schedule to account for these changes.");
    setError("");
  };
  function eventsChanged(next: Schedule) {
    if (mode === "backend") next = releaseConflictingPlacements(next);
    changed(next);
    if (mode === "backend" && hasStudyConflict(next)) {
      void scheduleWork({ ...next, needsReplan: true }, true);
    }
  }
  function move(move: CalendarMove) {
    if (busy) { setError("Wait for schedule generation to finish before moving an event."); return false; }
    const result = moveCalendarItem(schedule, move);
    if (!result.schedule) {
      setError(`Move reverted. ${result.error}`);
      setNotice("");
      return false;
    }
    if (move.type === "fixed") {
      const automatic = mode === "backend" && hasStudyConflict(result.schedule);
      eventsChanged(result.schedule);
      if (!automatic) setNotice("Commitment moved. Generate a schedule to account for this change. Only this occurrence was moved.");
      return true;
    }
    apply(result.schedule);
    setUndo(null);
    setError("");
    setNotice("Session moved and saved. This placement will be preserved when you regenerate.");
    return true;
  }
  async function scheduleWork(next = schedule, eventReplan = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const now = new Date();
      const result =
        mode === "demo"
          ? demoResult(next, now)
          : await generateSchedule(next, now);
      const updated = { ...next, ...result, source: mode, needsReplan: mode === "demo" ? next.needsReplan : false };
      const changes = planChanges(next, updated, now);
      const missing = result.warnings.reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
      apply(updated);
      setUndo({ mode, schedule: next });
      if (mode === "backend") setReview({ mode, before: next, after: updated, at: now });
      setNotice(
        mode === "demo"
          ? "Mock timetable refreshed. Demo replays authored sessions; it does not schedule new work."
          : `Your study schedule has been updated. ${changes.moved} moved, ${changes.added} added, ${changes.removed} removed; ${missing} minutes unscheduled.`,
      );
    } catch (error) {
      setError(
        (eventReplan ? "Commitment saved. Automatic rescheduling failed. Use Generate Schedule to retry. " : "") + (error instanceof Error
          ? error.message
          : "Scheduling failed. Your existing schedule is preserved."),
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
      needsReplan: true,
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
    setUndo(null);
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
      needsReplan: true,
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
    setUndo(null);
    setDialog(null);
    await scheduleWork(next);
  }
  async function skip(id: string) {
    const block = schedule.studyBlocks.find(item => item.id === id);
    if (!block || block.status !== "planned" || block.locked) return;
    const next: Schedule = { ...schedule, needsReplan: true,
      studyBlocks: schedule.studyBlocks.map(item => item.id === id ? { ...item, status: "skipped", locked: true } : item) };
    apply(next);
    setUndo(null);
    setDialog(null);
    await scheduleWork(next);
  }
  function switchMode(next: AppMode) {
    setReview(null);
    setWorkspace({ ...workspace!, mode: next });
    setPersist(true);
    setNotice("");
    setError("");
    setDialog(null);
    setUndo(null);
  }
  const remaining = schedule.tasks.reduce(
    (sum, task) => sum + task.remainingTimeMinutes,
    0,
  );
  const completed = schedule.studyBlocks.filter(
    (block) => block.status === "completed",
  ).length;
  const planned = upcomingMinutes(schedule);
  const missing = schedule.warnings.reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
  const selected =
    dialog?.type === "session"
      ? schedule.studyBlocks.find((block) => block.id === dialog.id)
      : undefined;
  const selectedTask =
    selected && schedule.tasks.find((task) => task.id === selected.taskId);
  const list = (
    <AssignmentList
      tasks={schedule.tasks}
      topics={schedule.topics}
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
          <header className="topbar">
            <Link className="brand" href="/" aria-label="ReFlo home">
              <span className="brand-icon">
                <CalendarDays size={23} />
              </span>
              <span>
                Re<span className="brand-light">Flo</span>
              </span>
            </Link>
            <div className="header-actions">
              <div className="mode-control">
                <FlaskConical size={15} />
                <label htmlFor="mode">Data source</label>
                <select
                  id="mode"
                  value={mode}
                  onChange={(event) => switchMode(event.target.value as AppMode)}
                >
                  <option value="demo">Demo mode</option>
                  <option value="backend">Real backend</option>
                </select>
              </div>
              <ThemeToggle />
            </div>
          </header>
          <aside className="sidebar">
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
            </nav>
            <div className="sidebar-actions">
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
              <button
                className="nav-item"
                onClick={() => setDialog({ type: "preferences" })}
              >
                <Settings2 size={19} />
                Preferences
              </button>
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
            <main id="main" className="main-content">
              <div className="page-heading">
                <div>
                  <h1>
                    {section === "calendar"
                      ? "My Schedule"
                      : "My Assignments"}
                  </h1>
                </div>
                <div className="page-actions">
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
                </div>
              </div>
              <div className="status-area" aria-live="polite">
                {schedule.needsReplan && <div className="plan-dirty" role="status"><strong>Plan needs updating.</strong> {mode === "demo" ? "Demo mode replays samples; use Real backend to schedule your changes." : "Generate Schedule to account for your latest changes."}</div>}
                {busy && (
                  <div className="info-banner">
                    <LoaderCircle className="spin" size={16} />
                    Updating your schedule…
                  </div>
                )}
                {notice && <div className="info-banner">{notice}</div>}
                {undo?.mode === mode && <div className="plan-actions">
                  <button className="button compact" onClick={() => {
                    apply({ ...undo.schedule, needsReplan: true });
                    setUndo(null);
                    setNotice("Previous calendar restored. Your task edits and progress reports were kept. Generate Schedule to update the plan.");
                    setError("");
                  }}>Undo last replan</button>
                </div>}
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
              {review?.mode === mode && <PlanReview {...review} onDismiss={() => setReview(null)} />}
              {mode === "backend" && (
                <AssistantPanel
                  key={mode}
                  schedule={schedule}
                  onBusy={setBusy}
                  onApply={(next) => {
                    const at = new Date();
                    apply(next);
                    setUndo({ mode, schedule: { ...schedule, tasks: next.tasks, events: next.events, topics: next.topics } });
                    setReview({ mode, before: schedule, after: next, at });
                    setError("");
                    setNotice("Changes applied and study schedule updated.");
                  }}
                />
              )}
              {schedule.warnings.length > 0 && (
                <TimeShortagePanel
                  schedule={schedule}
                  demo={mode === "demo"}
                />
              )}
              <div
                className={
                  section === "calendar" ? "work-grid" : "assignment-page"
                }
              >
                {section === "calendar" ? (
                  <WeeklyCalendar
                    changedBlockIds={review?.mode === mode ? planChangeDetails(review.before, review.after, review.at).flatMap(change => change.after ? [change.after.id] : []) : undefined}
                    busy={busy}
                    onMove={move}
                    events={schedule.events}
                    topics={schedule.topics}
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
                ) : (
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
                )}
              </div>
              <CalendarFiles key={`calendar-files-${mode}`} schedule={schedule} onImport={eventsChanged} />
              {section === "assignments" && (
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-icon purple">
                    <BookOpen size={20} />
                  </span>
                  <div>
                    <span>Remaining work</span>
                    <strong>
                      {hours(remaining)}
                      <small> across assignments</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon green">
                    <Clock3 size={20} />
                  </span>
                  <div>
                    <span>Upcoming study time</span>
                    <strong>
                      {hours(planned)}
                      <small> excludes past sessions</small>
                    </strong>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon blue">
                    <CheckCheck size={20} />
                  </span>
                  <div>
                    <span>Unscheduled work</span>
                    <strong>
                      {schedule.needsReplan ? "—" : hours(missing)}
                      <small>{schedule.needsReplan ? " update plan to calculate" : " needs a time slot"}</small>
                    </strong>
                  </div>
                </div>
              </div>
              )}
              <footer className="dashboard-footer">
              <div className="backup-actions">
                <button className="button compact" onClick={() => {
                  const url = URL.createObjectURL(new Blob([exportBackup(workspace)], { type: "application/json" }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `reflo-${new Date().toISOString().slice(0, 10)}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}>Export backup</button>
                <label className="button compact">
                  Import backup
                  <input aria-label="Import backup file" type="file" accept=".json,application/json" className="backup-file" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    try {
                      if (file.size > 5_000_000) throw new Error("Backup must be under 5 MB. Your current data is unchanged.");
                      setRestore(importBackup(await file.text()));
                      setError("");
                    } catch (error) { setError(error instanceof Error ? error.message : "Could not read backup."); }
                  }} />
                </label>
              </div>

                <span>{schedule.preferences.sleepHours.wakeUpTime} wake-up | {schedule.preferences.sleepHours.bedtime} bedtime | {completed} completed sessions saved</span>
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
              topics={schedule.topics}
              onSave={(task, topics) =>
                changed({
                  ...schedule,
                  topics,
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
                topics={schedule.topics}
                onSave={(event, topics) =>
                  eventsChanged({
                    ...schedule,
                    topics,
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
              onSkip={() => void skip(selected.id)}
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
      {restore && <Modal title="Restore backup?" onClose={() => { if (!busy) setRestore(null); }}>
        <div className="form-stack">
          <p>This replaces both saved workspaces on this device. The backup contains {restore.backend.tasks.length} real assignments and {restore.demo.tasks.length} demo assignments. Export your current data first if you want to keep it.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy} onClick={() => {
            try {
              saveWorkspace(restore);
              setWorkspace(restore);
              setReview(null);
              setPersist(true);
              setRestore(null);
              setDialog(null);
              setUndo(null);
              setError("");
              setNotice("Backup restored. Generate Schedule to update imported plans.");
            } catch { setError("Could not save the backup. Your current workspace is unchanged."); }
          }}>Replace workspaces with backup</button>
          <button className="button" disabled={busy} onClick={() => setRestore(null)}>Cancel restore</button>
        </div>
      </Modal>}
    </>
  );
}
