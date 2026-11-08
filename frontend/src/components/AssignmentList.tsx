import { AlertTriangle, Check, Pencil, Plus, Trash2 } from "lucide-react";
import type { Task, SchedulingWarning } from "@/datatypes";
import { dateLabel, hours } from "@/lib/calendar";

export default function AssignmentList({
  tasks,
  warnings,
  onEdit,
  onDelete,
  onAdd,
}: {
  tasks: Task[];
  warnings: SchedulingWarning[];
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onAdd: () => void;
}) {
  return (
    <section className="assignments" aria-labelledby="assignments-heading">
      <div className="panel-heading">
        <h2 id="assignments-heading">
          Assignments <span className="count">{tasks.length}</span>
        </h2>
        <button
          className="icon-button"
          aria-label="Add assignment"
          onClick={onAdd}
        >
          <Plus size={19} />
        </button>
      </div>
      <p className="muted small panel-subtitle">
        Your next deadlines, in order.
      </p>
      {!tasks.length && (
        <div className="empty">
          <p>No assignments yet.</p>
          <button className="button" onClick={onAdd}>
            Add your first assignment
          </button>
        </div>
      )}
      {[...tasks]
        .sort((a, b) => +a.deadline - +b.deadline)
        .map((task) => {
          const progress = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                (1 - task.remainingTimeMinutes / task.estimatedTimeMinutes) *
                  100,
              ),
            ),
          );
          const warning = warnings
            .filter((w) => w.taskId === task.id)
            .reduce((sum, w) => sum + w.unscheduledMinutes, 0);
          return (
            <article className="assignment" key={task.id}>
              <div className="assignment-top">
                <span
                  className={`task-status ${progress === 100 ? "done" : ""}`}
                >
                  {progress === 100 ? (
                    <>
                      <Check size={12} /> Complete
                    </>
                  ) : (
                    "In progress"
                  )}
                </span>
                <div className="inline-actions">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${task.name}`}
                    onClick={() => onEdit(task)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${task.name}`}
                    onClick={() => onDelete(task)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <h3>{task.name}</h3>
              <p
                className={`deadline ${task.deadline < new Date() && progress < 100 ? "overdue" : ""}`}
              >
                Due {dateLabel(task.deadline)}
              </p>
              <div className="task-facts">
                <span>{task.gradeWeight}% of grade</span>
                <span>{hours(task.estimatedTimeMinutes)} estimated</span>
              </div>
              <div className="progress-label">
                <span>{hours(task.remainingTimeMinutes)} remaining</span>
                <span>{progress}%</span>
              </div>
              <div
                className="progress"
                role="progressbar"
                aria-label={`${task.name} progress`}
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              {warning > 0 && (
                <p className="task-warning">
                  <AlertTriangle size={14} />
                  {hours(warning)} still needs a time slot
                </p>
              )}
            </article>
          );
        })}
    </section>
  );
}
