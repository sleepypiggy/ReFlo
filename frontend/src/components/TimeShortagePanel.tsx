import type { Schedule } from "@/datatypes";
import { AlertTriangle, ChevronDown } from "lucide-react";
import ShortageSuggestions from "./ShortageSuggestions";

const time = (minutes: number) => {
  const wholeHours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [wholeHours ? `${wholeHours}h` : "", rest ? `${rest}m` : ""]
    .filter(Boolean).join(" ") || "0h";
};

export default function TimeShortagePanel({ schedule, demo }: {
  schedule: Schedule;
  demo: boolean;
}) {
  if (!demo) return <ShortageSuggestions schedule={schedule} />;
  return <DemoShortages schedule={schedule} demo={demo} />;
}

function DemoShortages({ schedule, demo }: { schedule: Schedule; demo: boolean }) {
  const tasks = schedule.tasks.filter((task) => task.remainingTimeMinutes > 0);
  const required = tasks.reduce((sum, task) => sum + task.remainingTimeMinutes, 0);
  const missing = schedule.warnings.reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
  const deadline = tasks.length
    ? new Date(Math.max(...tasks.map((task) => +task.deadline)))
    : null;

  return (
    <section className="shortage-panel" aria-label="Not all work fits">
      <details className="shortage-disclosure">
        <summary className="shortage-summary">
          <AlertTriangle size={30} aria-hidden="true" />
          <span className="shortage-notice" role="status">
            <strong>{schedule.warnings.length} {schedule.warnings.length === 1 ? "alert" : "alerts"}</strong>
          </span>
          <span className="shortage-details-label">View details</span>
          <ChevronDown size={16} className="shortage-chevron" aria-hidden="true" />
        </summary>
        <div className="shortage-content">
      {schedule.needsReplan ? <p role="status">These shortages belong to the previous plan. Generate a schedule to update them.</p> : <p>
        You have <strong>{time(required)} of work</strong>
        {deadline && <> due by {deadline.toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
        })}</>}. Under your current preferences, the current plan fits{" "}
        <strong>{time(Math.max(0, required - missing))}</strong>;{" "}
        <strong>{time(missing)} remains unscheduled</strong>.
      </p>}
      <ul className="shortage-breakdown">
        {schedule.warnings.map((warning, index) => (
          <li key={`${warning.taskId}-${index}`}>
            <strong>{schedule.tasks.find((task) => task.id === warning.taskId)?.name}</strong>
            : {time(warning.unscheduledMinutes)} unscheduled — {warning.reason}
          </li>
        ))}
      </ul>
      {demo && <p className="muted small">Switch to Real Backend to schedule using grade weights and deadlines.</p>}
        </div>
      </details>
    </section>
  );
}
