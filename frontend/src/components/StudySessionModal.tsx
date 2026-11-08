import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { StudyBlock, Task } from "@/datatypes";
import { dateLabel, duration } from "@/lib/calendar";

export default function StudySessionModal({
  block,
  task,
  busy,
  onComplete,
  onUnfinished,
}: {
  block: StudyBlock;
  task: Task;
  busy: boolean;
  onComplete: () => void;
  onUnfinished: (minutes: number) => void;
}) {
  const [unfinished, setUnfinished] = useState(false);
  const canAct = block.status === "planned" && !block.locked;
  return (
    <div className="form-stack">
      <span
        className={`task-status ${block.status === "completed" ? "done" : ""}`}
      >
        {block.status}
      </span>
      <h3 className="session-title">{task.name}</h3>
      <p className="muted">
        {dateLabel(block.startTime)} – {dateLabel(block.endTime)}
      </p>
      <div className="session-duration">
        {duration(block)} <span>minutes of focused study</span>
      </div>
      {!canAct && (
        <p className="muted">This session is saved in your study history.</p>
      )}
      {canAct && !unfinished && (
        <>
          <button
            className="button primary"
            disabled={busy}
            onClick={onComplete}
          >
            <Check size={17} />
            Mark Complete
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => setUnfinished(true)}
          >
            <RotateCcw size={16} />I Didn&apos;t Finish
          </button>
        </>
      )}
      {canAct && unfinished && (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onUnfinished(Math.round(Number(data.get("remaining"))));
          }}
        >
          <label>
            Total assignment work remaining (minutes)
            <input
              autoFocus
              name="remaining"
              type="number"
              min="0"
              max="60000"
              step="1"
              required
              defaultValue={task.remainingTimeMinutes}
            />
          </label>
          <p className="muted small">
            Enter the total remaining across the whole assignment. This session
            stays in your history. Future planned sessions will be replaced only
            after a successful scheduling response.
          </p>
          <button className="button primary" disabled={busy}>
            {busy ? "Rescheduling…" : "Save remaining & reschedule"}
          </button>
        </form>
      )}
    </div>
  );
}
