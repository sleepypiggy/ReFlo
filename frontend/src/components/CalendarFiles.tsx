import { useRef, useState } from "react";
import type { Schedule } from "@/datatypes";
import { CALENDAR_LIMITS, exportStudyCalendar, importCalendarEvents, previewCalendar, type CalendarPreview } from "@/lib/ical";
import Modal from "./Modal";

export default function CalendarFiles({ schedule, onImport }: { schedule: Schedule; onImport: (next: Schedule) => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CalendarPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const request = useRef(0);
  const existing = new Set(schedule.events.map(event => event.id));
  const available = preview?.events.filter(event => !existing.has(event.id)) ?? [];
  const count = available.filter(event => selected.has(event.id)).length;
  const exportCount = schedule.studyBlocks.filter(block => block.status === "planned" && block.endTime > new Date()).length;
  const close = () => { request.current++; setOpen(false); setLoading(false); };
  return <div className="calendar-files">
    <div className="backup-actions">
      <button className="button compact" onClick={() => { setOpen(true); setPreview(null); setError(""); setSuccess(""); }}>Import calendar (.ics)</button>
      <button className="button compact" disabled={!exportCount} onClick={() => {
        try {
          const url = URL.createObjectURL(new Blob([exportStudyCalendar(schedule)], { type: "text/calendar;charset=utf-8" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "schedule-maker-study.ics";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setError(""); setSuccess("Study calendar downloaded.");
        } catch (error) { setError(error instanceof Error ? error.message : "Calendar export failed."); }
      }}>Export study calendar</button>
    </div>
    <p className="muted small">Calendar files are snapshots, not ongoing synchronization. Export includes upcoming planned study sessions only.{!exportCount && " No planned sessions to export."}</p>
    {!open && error && <p className="error" role="alert">{error}</p>}
    {!open && success && <p role="status">{success}</p>}
    {open && <Modal title="Import fixed commitments" onClose={close}>
      <div className="form-stack">
        <p>Select a calendar to preview. Nothing is saved until you confirm. Supports timed events and weekly classes with COUNT or UNTIL, up to 366 days and 1000 occurrences. Files must be under 1 MB.</p>
        <label>Calendar file (.ics)
          <input type="file" accept=".ics,text/calendar" onChange={async event => {
            const file = event.target.files?.[0];
            const current = ++request.current;
            setPreview(null); setSelected(new Set()); setError(""); setSuccess("");
            if (!file) { setLoading(false); return; }
            setLoading(true);
            try {
              if (!/\.ics$/i.test(file.name)) throw new Error("Choose an .ics calendar file.");
              if (file.size > CALENDAR_LIMITS.bytes) throw new Error("Calendar files must be under 1 MB.");
              const result = await previewCalendar(await file.text());
              if (current !== request.current) return;
              setPreview(result);
              setSelected(new Set(result.events.filter(item => !existing.has(item.id)).map(item => item.id)));
            } catch (error) { if (current === request.current) setError(error instanceof Error ? error.message : "Could not read calendar."); }
            finally { if (current === request.current) setLoading(false); }
          }} />
        </label>
        {loading && <p role="status">Reading calendar and expanding recurring classes…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {success && <p role="status">{success}</p>}
        {preview && <>
          {preview.warnings.length > 0 && <div role="alert"><strong>Some items cannot be imported:</strong><ul>{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          <p role="status">{available.length} new occurrences; {preview.events.length - available.length} already imported. Existing commitments are kept on repeated import.</p>
          {!preview.events.length && <p>No supported events found. Check the warnings or choose another file.</p>}
          {!!available.length && <label className="calendar-choice"><input type="checkbox" checked={count === available.length} onChange={event => setSelected(new Set(event.target.checked ? available.map(item => item.id) : []))} />Select all new occurrences</label>}
          <div className="calendar-preview" aria-label="Calendar event preview">
            {preview.events.map(event => <label key={event.id} className="calendar-choice">
              <input type="checkbox" disabled={existing.has(event.id)} checked={existing.has(event.id) || selected.has(event.id)} onChange={change => setSelected(previous => {
                const next = new Set(previous); if (change.target.checked) next.add(event.id); else next.delete(event.id); return next;
              })} />
              <span><strong>{event.name}</strong>{existing.has(event.id) && " — already imported"}<br />
                {event.startTime.toLocaleString(undefined, { timeZone: event.calendarImport!.timezone, timeZoneName: "short" })} – {event.endTime.toLocaleString(undefined, { timeZone: event.calendarImport!.timezone, timeZoneName: "short" })}<br />
                <small>{event.calendarImport!.timezone} · UTC {event.startTime.toISOString()} – {event.endTime.toISOString()}</small>
              </span>
            </label>)}
          </div>
          <p className="muted small">Imported occurrences become fixed commitments. Generate Schedule afterward to avoid them. Cancelled occurrences are omitted; moved occurrences use their updated times. Repeated imports skip existing identifiers; they do not synchronize edits or deletions.</p>
          <button className="button primary" disabled={!count || loading} onClick={() => {
            try {
              const next = importCalendarEvents(schedule, available.filter(event => selected.has(event.id)));
              onImport(next); setSelected(new Set()); setError("");
              setSuccess(`Imported ${next.events.length - schedule.events.length} commitments. Generate Schedule to update your plan.`);
            } catch (error) { setError(error instanceof Error ? error.message : "Import failed."); }
          }}>Import {count} selected commitments</button>
        </>}
        <button className="button" onClick={close}>Close</button>
      </div>
    </Modal>}
  </div>;
}
