import { useState, type FormEvent } from "react";
import { Task } from "@/datatypes";
import { localInput } from "@/lib/calendar";

export default function AssignmentForm({
  task,
  onSave,
}: {
  task?: Task;
  onSave: (task: Task) => void;
}) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const deadline = new Date(String(form.get("deadline")));
    const minutes = Math.round(Number(form.get("hours")) * 60);
    const gradeWeight = Number(form.get("weight"));
    if (
      !name ||
      !Number.isFinite(deadline.getTime()) ||
      minutes < 1 ||
      !Number.isFinite(minutes) ||
      gradeWeight < 0 ||
      gradeWeight > 100
    ) {
      setError(
        "Enter a name, valid deadline, positive work estimate, and weight from 0 to 100.",
      );
      return;
    }
    const alreadyWorked = task
      ? task.estimatedTimeMinutes - task.remainingTimeMinutes
      : 0;
    onSave(
      new Task({
        id: task?.id ?? crypto.randomUUID(),
        name,
        deadline,
        estimatedTimeMinutes: minutes,
        remainingTimeMinutes: task
          ? Math.max(0, minutes - alreadyWorked)
          : minutes,
        gradeWeight,
      }),
    );
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <p className="muted">
        Give each assignment a deadline and a work estimate.
      </p>
      <label>
        Assignment name
        <input
          name="name"
          required
          maxLength={150}
          defaultValue={task?.name}
          placeholder="e.g. CPSC 210 problem set"
          autoFocus
        />
      </label>
      <label>
        Deadline
        <input
          name="deadline"
          type="datetime-local"
          required
          defaultValue={task ? localInput(task.deadline) : ""}
        />
      </label>
      <div className="form-row">
        <label>
          Estimated hours
          <input
            name="hours"
            type="number"
            min="0.0167"
            max="1000"
            step="any"
            defaultValue={task ? task.estimatedTimeMinutes / 60 : 3}
            required
          />
        </label>
        <label>
          Grade weight (%)
          <input
            name="weight"
            type="number"
            min="0"
            max="100"
            step="0.1"
            defaultValue={task?.gradeWeight ?? 10}
            required
          />
        </label>
      </div>
      <p className="muted small">
        Higher grade weights get study time first. Equal weights use the closest deadline.
      </p>
      {task && (
        <p className="muted small">
          Editing the estimate preserves the amount of work already recorded.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" type="submit">
        {task ? "Save assignment" : "Add assignment"}
      </button>
    </form>
  );
}
