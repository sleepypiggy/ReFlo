import { useState, type FormEvent } from "react";
import type { Preferences } from "@/datatypes";

export default function PreferencesPanel({
  preferences,
  onSave,
}: {
  preferences: Preferences;
  onSave: (preferences: Preferences) => void;
}) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const maxStudyTimeMinutes = Math.round(Number(data.get("daily")) * 60);
    const maxSessionTimeMinutes = Number(data.get("session"));
    const breakDurationMinutes = Number(data.get("break"));
    const bedtime = String(data.get("bedtime")),
      wakeUpTime = String(data.get("wake"));
    if (!Number.isInteger(maxSessionTimeMinutes) || maxSessionTimeMinutes < 15) {
      setError("Maximum session length must be at least 15 minutes.");
      return;
    }
    if (bedtime === wakeUpTime || maxSessionTimeMinutes > maxStudyTimeMinutes) {
      setError(
        "Wake-up and bedtime must differ. A session cannot exceed the daily study limit.",
      );
      return;
    }
    onSave({
      maxStudyTimeMinutes,
      maxSessionTimeMinutes,
      breakDurationMinutes,
      spreadAssignments: data.get("spread") === "on",
      sleepHours: { bedtime, wakeUpTime },
    });
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="muted">
        Make room for rest. These limits are sent to the scheduler.
      </p>
      <div className="form-row">
        <label>
          Wake-up time
          <input
            name="wake"
            type="time"
            required
            defaultValue={preferences.sleepHours.wakeUpTime}
          />
        </label>
        <label>
          Bedtime
          <input
            name="bedtime"
            type="time"
            required
            defaultValue={preferences.sleepHours.bedtime}
          />
        </label>
      </div>
      <label>
        Maximum daily study (hours)
        <input
          name="daily"
          type="number"
          min="0.25"
          max="24"
          step="0.25"
          required
          defaultValue={preferences.maxStudyTimeMinutes / 60}
        />
      </label>
      <label>
        Maximum session (minutes)
        <input
          name="session"
          type="number"
          min="15"
          max="1440"
          step="1"
          required
          defaultValue={preferences.maxSessionTimeMinutes}
          aria-describedby="session-minimum"
        />
      </label>
      <p id="session-minimum" className="muted small">New study blocks need at least 15 minutes. Smaller amounts of remaining work stay unscheduled without rounding up your estimate.</p>
      <label>
        Break duration (minutes)
        <input
          name="break"
          type="number"
          min="0"
          max="180"
          step="1"
          required
          defaultValue={preferences.breakDurationMinutes}
        />
      </label>
      <label className="checkbox-label">
        <input name="spread" type="checkbox" defaultChecked={preferences.spreadAssignments ?? true} />
        Spread study sessions across days
      </label>
      <p className="muted small">Balance work across days and morning, afternoon, and evening slots when available. Conflicts, sleep and deadlines take priority; tight days may still need consecutive sessions.</p>

      <p className="muted small">
        Earlier deadlines reserve study slots first. When work does not fit,
        priority combines grade weight with remaining work relative to available
        time before each deadline. Equal scores use the earlier deadline, then
        greater deadline pressure, then assignment ID. Sleep, fixed commitments,
        and study limits stay protected.
        Edit an assignment&apos;s grade weight or deadline, then generate a new
        schedule to account for changes.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" type="submit">
        Save preferences
      </button>
    </form>
  );
}
