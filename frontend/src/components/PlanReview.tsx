import type { Schedule } from "@/datatypes";
import { dateLabel, duration } from "@/lib/calendar";
import { planChangeDetails, planChanges } from "@/lib/plan";

export default function PlanReview({ before, after, at, onDismiss }: {
  before: Schedule; after: Schedule; at: Date; onDismiss: () => void;
}) {
  const changes = planChangeDetails(before, after, at);
  const counts = planChanges(before, after, at);
  const slot = (block: NonNullable<(typeof changes)[number]["before"]>) =>
    `${dateLabel(block.startTime)} – ${dateLabel(block.endTime)} (${duration(block)} min)`;
  const missing = after.warnings.reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
  return <section className="plan-review" aria-label="Latest schedule changes">
    <div className="plan-review-heading">
      <h2>What changed</h2>
      <button className="button compact" onClick={onDismiss}>Dismiss changes</button>
    </div>
    <p>{counts.moved} moved, {counts.added} added, {counts.removed} removed. {missing} minutes unscheduled.</p>
    {changes.length ? <>
      <p className="muted small">Changed sessions are outlined on the calendar. Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. When a session is split or combined, entries are compared in time order within each assignment.</p>
      <ul className="plan-review-list">{changes.map((change, index) => <li key={index}>
        <strong>{after.tasks.find(task => task.id === change.taskId)?.name ?? before.tasks.find(task => task.id === change.taskId)?.name ?? "Assignment"}</strong>
        <span className="plan-change-kind">{change.before && change.after ? "Moved / adjusted" : change.after ? "Added" : "Removed"}</span>
        {change.before && <span>Previous: {slot(change.before)}</span>}
        {change.after && <span>Now: {slot(change.after)}</span>}
      </li>)}</ul>
    </> : <p>No study times changed.</p>}
    <p className="muted small">Past and locked entries are kept. Undo last replan restores the previous study calendar while keeping your saved commitments and task updates; generate again afterward to check conflicts.</p>
  </section>;
}
