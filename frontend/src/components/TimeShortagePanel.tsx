import type { Schedule } from "@/datatypes";

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
  const tasks = schedule.tasks.filter((task) => task.remainingTimeMinutes > 0);
  const required = tasks.reduce((sum, task) => sum + task.remainingTimeMinutes, 0);
  const missing = schedule.warnings.reduce((sum, warning) => sum + warning.unscheduledMinutes, 0);
  const deadline = tasks.length
    ? new Date(Math.max(...tasks.map((task) => +task.deadline)))
    : null;

  return (
    <section className="shortage-panel" aria-labelledby="shortage-heading">
      <h2 id="shortage-heading">Not all work fits</h2>
      <p role="status">
        You have <strong>{time(required)} of work</strong>
        {deadline && <> due by {deadline.toLocaleDateString(undefined, {
          weekday: "short", month: "short", day: "numeric", year: "numeric",
        })}</>}. Under your deadlines and preferences, the current plan fits{" "}
        <strong>{time(Math.max(0, required - missing))}</strong>;{" "}
        <strong>{time(missing)} remains unscheduled</strong>.
      </p>
      <p className="muted small">
        Higher grade weights get study time first. Equal weights use the closest
        deadline. Sleep, fixed commitments, and study limits stay protected.
        Edit an assignment&apos;s grade weight or deadline, then generate a new
        schedule to account for changes.
      </p>
      <ul className="shortage-breakdown">
        {schedule.warnings.map((warning, index) => (
          <li key={`${warning.taskId}-${index}`}>
            <strong>{schedule.tasks.find((task) => task.id === warning.taskId)?.name}</strong>
            : {time(warning.unscheduledMinutes)} unscheduled — {warning.reason}
          </li>
        ))}
      </ul>
      {demo && <p className="muted small">Switch to Real Backend to schedule using grade weights and deadlines.</p>}
    </section>
  );
}
