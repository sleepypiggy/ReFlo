import { useState, type FormEvent } from "react";
import type { Event, Schedule } from "@/datatypes";
import { generateSchedule, parseAssistant } from "@/lib/api";
import TimeShortagePanel from "./TimeShortagePanel";

const when = (date: Date) => date.toLocaleString(undefined, {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});

export default function AssistantPanel({ schedule, onApply, onBusy }: {
  schedule: Schedule;
  onApply: (next: Schedule) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [context, setContext] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<{ base: Schedule; next: Schedule; event: Event } | null>(null);
  // Any intervening edit invalidates the preview so Apply cannot overwrite newer work.
  const currentPreview = preview?.base === schedule ? preview : null;

  function reset() {
    setPreview(null);
    setContext("");
    setQuestion("");
    setInput("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || pending) return;
    const message = context ? `${context}\nUser: ${input.trim()}` : input.trim();
    if (message.length > 10000) {
      setError("This conversation is too long. Start over with a shorter request.");
      return;
    }
    setPending(true);
    onBusy(true);
    setError("");
    setPreview(null);
    try {
      const now = new Date();
      const result = await parseAssistant(message, now);
      if (result.type === "clarification") {
        setContext(`${message}\nAssistant: ${result.question}`);
        setQuestion(result.question);
        setInput("");
        return;
      }
      const startTime = new Date(result.start), endTime = new Date(result.end);
      const minutes = Math.round((+endTime - +startTime) / 60000);
      const draft: Event = {
        id: crypto.randomUUID(), name: result.title, startTime, endTime,
        timeMinutes: minutes, remainingTimeMinutes: minutes,
      };
      const next = { ...schedule, events: [...schedule.events, draft] };
      const revised = await generateSchedule(next, now);
      setPreview({ base: schedule, next: { ...next, ...revised, source: "backend" }, event: draft });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Assistant request failed. Please try again.");
    } finally {
      setPending(false);
      onBusy(false);
    }
  }

  return (
    <section className="assistant-panel form-stack" aria-label="Schedule assistant">
      <h2>Schedule assistant</h2>
      <p className="muted">Tell me about a commitment. Review the revised study plan before applying it.</p>
      <form className="form-stack" onSubmit={submit}>
        {question && <p role="status">{question}</p>}
        <label>
          {question ? "Your answer" : "Assistant message"}
          <textarea required maxLength={10000} rows={2} value={input}
            onChange={(event) => { setInput(event.target.value); setPreview(null); }}
            placeholder="e.g. I’m working tonight" />
        </label>
        <div className="assistant-actions">
          <button className="button primary" disabled={pending || !input.trim()} type="submit">
            {pending ? "Preparing preview…" : "Preview schedule"}
          </button>
          {(context || preview || error) && <button className="button" type="button" onClick={reset}>Start over</button>}
        </div>
      </form>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {currentPreview && (
        <section className="assistant-preview form-stack" aria-label="Revised schedule preview">
          <h3>Revised schedule preview</h3>
          <p><strong>{currentPreview.event.name}</strong><br />
            {when(currentPreview.event.startTime)} – {when(currentPreview.event.endTime)}</p>
          <p className="muted">Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Existing commitments and locked history are kept. Your calendar has not changed.</p>
          <h4>Revised study sessions</h4>
          {currentPreview.next.studyBlocks.length ? <ul className="assistant-sessions">
            {[...currentPreview.next.studyBlocks].sort((a, b) => +a.startTime - +b.startTime).map((block) => (
              <li key={block.id}>
                <strong>{schedule.tasks.find((task) => task.id === block.taskId)?.name}</strong>
                <span>{when(block.startTime)} – {when(block.endTime)} ({block.status})</span>
              </li>
            ))}
          </ul> : <p>No study sessions in the revised plan.</p>}
          {currentPreview.next.warnings.length > 0 && <TimeShortagePanel schedule={currentPreview.next} demo={false} />}
          <div className="assistant-actions">
            <button className="button primary" onClick={() => { onApply(currentPreview.next); reset(); }}>Apply</button>
            <button className="button" onClick={() => setPreview(null)}>Discard preview</button>
          </div>
        </section>
      )}
    </section>
  );
}
