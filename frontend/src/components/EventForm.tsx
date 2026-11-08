import { useState, type FormEvent } from "react";
import type { Event, Topic, Weekday } from "@/datatypes";
import { localInput } from "@/lib/calendar";
import { initialTopicSelection, resolveTopicSelection } from "@/lib/topics";
import TopicPicker from "./TopicPicker";

export default function EventForm({
  event: fixed,
  topics = [],
  onSave,
}: {
  event?: Event;
  topics?: Topic[];
  onSave: (event: Event, topics: Topic[]) => void;
}) {
  const [error, setError] = useState("");
  const [topicSelection, setTopicSelection] = useState(() => initialTopicSelection(topics, fixed?.topicId, fixed?.color));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startTime = new Date(String(form.get("start"))),
      endTime = new Date(String(form.get("end")));
    const name = String(form.get("name")).trim();
    const repeatOn = form.getAll("weekday").map(Number) as Weekday[];
    const timeMinutes = Math.round(
      (endTime.getTime() - startTime.getTime()) / 60000,
    );
    if (!name || !Number.isFinite(timeMinutes) || timeMinutes <= 0) {
      setError("Add a name and an end time after the start time.");
      return;
    }
    if (repeatOn.length && timeMinutes >= 1440) {
      setError("Recurring commitments must be shorter than 24 hours.");
      return;
    }
    let selection;
    try {
      selection = resolveTopicSelection(topics, topicSelection);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save topic.");
      return;
    }
    onSave({
      id: fixed?.id ?? crypto.randomUUID(),
      calendarImport: fixed?.calendarImport,
      name,
      startTime,
      endTime,
      timeMinutes,
      remainingTimeMinutes: timeMinutes,
      repeatOn,
      topicId: selection.topicId,
      color: selection.color,
    }, selection.topics);
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="muted">
        Reserve time for classes, meals, work, and everything else.
      </p>
      <label>
        Event name
        <input
          name="name"
          required
          maxLength={150}
          defaultValue={fixed?.name}
          autoFocus
          placeholder="e.g. Intramural volleyball"
        />
      </label>
      <TopicPicker topics={topics} value={topicSelection} onChange={(value) => {
        setTopicSelection(value);
        setError("");
      }} />
      <label>
        Start datetime
        <input
          name="start"
          type="datetime-local"
          defaultValue={fixed ? localInput(fixed.startTime) : ""}
          required
        />
      </label>
      <label>
        End datetime
        <input
          name="end"
          type="datetime-local"
          defaultValue={fixed ? localInput(fixed.endTime) : ""}
          required
        />
      </label>
      <fieldset>
        <legend>
          Repeat weekly <span className="muted">(optional)</span>
        </legend>
        <div className="weekdays">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  name="weekday"
                  value={index}
                  defaultChecked={fixed?.repeatOn?.includes(index as Weekday)}
                />
                {day}
              </label>
            ),
          )}
        </div>
      </fieldset>
      <p className="muted small">
        Repeats begin on the start date, at the original local times.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" type="submit">
        {fixed ? "Save event" : "Add event"}
      </button>
    </form>
  );
}
