"use client";
import { useEffect, useRef, useState } from "react";
import type { Schedule } from "@/datatypes";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { generateSchedule } from "@/lib/api";
import { checkShortageSuggestions, minutesLabel, shortageKey, shortageRows,
  shortagesAreStale, suggestionIsCurrent, type SuggestionResult } from "@/lib/shortages";

export default function ShortageSuggestions({ schedule }: { schedule: Schedule }) {
  return <Shortages key={shortageKey(schedule)} schedule={schedule} />;
}

function Shortages({ schedule }: { schedule: Schedule }) {
  const [now, setNow] = useState(() => new Date());
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, []);
  const stale = shortagesAreStale(schedule, now) || !!result?.stale;
  const current = result && !stale && suggestionIsCurrent(result, schedule, now);
  const rows = shortageRows(schedule, now).filter(row => row.missing > 0);

  async function check() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setFailed(false); setResult(null);
    try {
      const checked = await checkShortageSuggestions(schedule, generateSchedule, new Date(), controller.signal);
      if (!controller.signal.aborted) { setResult(checked); setNow(new Date()); }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="shortage-panel" aria-label="Not all work fits">
    <details className="shortage-disclosure">
      <summary className="shortage-summary">
        <AlertTriangle size={30} aria-hidden="true" />
        <span className="shortage-notice" role="status"><strong>{rows.length} {rows.length === 1 ? "alert" : "alerts"}{stale ? " · Out of date" : ""}</strong></span>
        <span className="shortage-details-label">View details</span>
        <ChevronDown size={16} className="shortage-chevron" aria-hidden="true" />
      </summary>
      <div className="shortage-content">
        {stale && <p role="status">These shortages are out of date. Generate a schedule to update them and check suggestions.</p>}
        <ul className="shortage-breakdown">
          {rows.map(({ task, scheduled, missing }) => <li key={task.id}>
            <p><strong>{task.name}</strong>{stale
              ? `: the previous plan reported ${minutesLabel(missing)} unscheduled.`
              : ` needs ${minutesLabel(task.remainingTimeMinutes)}; ${minutesLabel(scheduled)} ${scheduled === 1 || scheduled === 60 ? "is" : "are"} scheduled; ${minutesLabel(missing)} ${missing === 1 || missing === 60 ? "remains" : "remain"} unscheduled.`}</p>
            {!stale && task.remainingTimeMinutes < 15 &&
              <p>The remaining work is below the scheduler’s 15-minute minimum session length. Your estimate is unchanged.</p>}
            {current && <p>{result.suggestions.find(item => item.taskId === task.id)?.message}</p>}
          </li>)}
        </ul>
        {!stale && <>
          <button className="button compact" disabled={busy} onClick={() => void check()}>
            {busy ? "Checking daily limits…" : "Check daily-limit suggestions"}
          </button>
          <p className="muted small">Checks up to three higher daily limits. Suggestions are informational; your preferences and calendar stay saved as they are.</p>
        </>}
        {result && !result.stale && !current && !stale && <p role="status">Suggestions expired. Check again for current results.</p>}
        {failed && <p role="status">Could not check suggestions. Your saved plan is unchanged. Try again.</p>}
      </div>
    </details>
  </section>;
}
