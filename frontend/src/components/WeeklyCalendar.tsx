import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar, { type CalendarRef } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { ChevronLeft, ChevronRight, LockKeyhole, Sparkles } from "lucide-react";
import type { Event, StudyBlock, Task, Topic } from "@/datatypes";
import { dateLabel, expandEvents, weekStart } from "@/lib/calendar";
import { colorPalette } from "@/lib/topics";
import { canMoveStudy, studyMoveReason, type CalendarMove } from "@/lib/calendarMoves";
import { eventPreviewChanges, type CalendarPlanPreview } from "@/lib/eventPreview";

export default function WeeklyCalendar({
  events,
  studyBlocks,
  tasks,
  topics = [],
  onStudyClick,
  onEventClick,
  onMove,
  busy = false,
  changedBlockIds,
  preview = null,
}: {
  events: Event[];
  studyBlocks: StudyBlock[];
  tasks: Task[];
  topics?: Topic[];
  onStudyClick: (id: string) => void;
  onEventClick: (id: string) => void;
  onMove: (move: CalendarMove) => boolean;
  busy?: boolean;
  changedBlockIds?: string[];
  preview?: CalendarPlanPreview | null;
}) {
  const ref = useRef<CalendarRef>(null);
  const [view, setView] = useState("timeGridWeek");
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const activePreview = desktop ? preview : null;
  const changes = useMemo(() => activePreview
    ? eventPreviewChanges(activePreview.base, activePreview.next, activePreview.now) : null, [activePreview]);
  useEffect(() => {
    if (!activePreview || !changes) return;
    const dates = [...changes.removed, ...changes.added,
      ...activePreview.next.events.filter(event => !activePreview.base.events.some(old => old.id === event.id))]
      .map(item => item.startTime).sort((a, b) => +a - +b);
    if (dates[0]) {
      // Day view gives both placements enough room for readable labels, even
      // when the original session overlaps the proposed fixed commitment.
      const frame = requestAnimationFrame(() => {
        setView("timeGridDay");
        ref.current?.getApi().changeView("timeGridDay", dates[0]);
        ref.current?.getApi().scrollToTime({ hours: Math.max(6, dates[0].getHours() - 1) });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [activePreview, changes]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [title, setTitle] = useState("");
  const [range, setRange] = useState(() => {
    const start = weekStart();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  });
  const calendarEvents = useMemo(
    () => [
      ...expandEvents([...events, ...(activePreview?.next.events.filter(event =>
        !activePreview.base.events.some(old => old.id === event.id)) ?? [])], range.start, range.end).map((event) => {
        const proposed = !!activePreview && !events.some(old => old.id === event.id);
        const topic = topics.find((topic) => topic.id === event.topicId);
        const color = topic?.color ?? event.color;
        const palette = color ? colorPalette(color) : null;
        return {
        id: `${proposed ? "preview-fixed" : "fixed"}:${event.instanceId}`,
        title: event.name,
        start: event.startTime,
        end: event.endTime,
        startEditable: proposed ? false : !busy,
        className: `calendar-event ${proposed ? "calendar-preview-fixed calendar-preview-proposed" : "fixed-event"}${color ? " topic-study" : ""}`,
        color: palette?.background ?? "var(--lecture-bg)",
        contrastColor: palette?.foreground ?? "var(--lecture-ink)",
        extendedProps: { type: proposed ? "preview" : "fixed", eventId: event.id, occurrenceStart: event.startTime, topicName: topic?.name, previewLabel: proposed ? "Proposed" : undefined },
      };
      }),
      ...studyBlocks.filter(block => !changes?.removed.some(old => old.taskId === block.taskId &&
        +old.startTime === +block.startTime && +old.endTime === +block.endTime)).map((block) => {
        const task = tasks.find((task) => task.id === block.taskId);
        const topic = topics.find((topic) => topic.id === task?.topicId);
        const color = topic?.color ?? task?.color;
        const palette = color ? colorPalette(color) : null;
        return {
        id: `study:${block.id}`,
        title:
          task?.name ??
          "Study session",
        start: block.startTime,
        end: block.endTime,
        startEditable: canMoveStudy(block, now),
        color:
          block.status === "completed"
            ? "var(--surface-soft)"
            : block.status === "unfinished" || block.status === "skipped"
              ? "var(--unfinished-bg)"
              : palette?.background ?? "var(--study-bg)",
        contrastColor:
          block.status === "completed"
            ? "var(--secondary-ink)"
            : block.status === "unfinished" || block.status === "skipped"
              ? "var(--unfinished-ink)"
              : palette?.foreground ?? "var(--study-ink)",
        className:
          block.status === "completed"
            ? "calendar-event completed-event"
            : block.status === "skipped"
              ? "calendar-event skipped-event"
            : block.status === "unfinished"
              ? "calendar-event unfinished-event"
              : `calendar-event study-event${color ? " topic-study" : ""}${changedBlockIds?.includes(block.id) ? " changed-study-event" : ""}`,
        extendedProps: {
          type: "study",
          blockId: block.id,
          status: block.status,
          topicName: topic?.name,
          changed: changedBlockIds?.includes(block.id),
          moveReason: studyMoveReason(block, now),
        },
      };
      }),
      ...([
        ["Previous", changes?.removed ?? []], ["Proposed", changes?.added ?? []],
      ] as const).flatMap(([label, blocks]) => blocks.map(block => ({
        id: `preview:${label}:${block.taskId}:${+block.startTime}:${+block.endTime}`,
        title: activePreview?.next.tasks.find(task => task.id === block.taskId)?.name ?? "Study session",
        start: block.startTime, end: block.endTime, startEditable: false,
        className: `calendar-event calendar-preview-study calendar-preview-${label.toLowerCase()}`,
        color: "var(--study-bg)", contrastColor: "var(--study-ink)",
        extendedProps: { type: "preview", previewLabel: label },
      }))),
    ],
    [events, range, studyBlocks, tasks, topics, changedBlockIds, now, activePreview, changes, busy],
  );
  return (
    <section className="calendar-card" aria-label="Study calendar">
      {activePreview && <p className="calendar-preview-notice" role="status">Preview only · Previous / Proposed · Use Flo’s Apply or Discard to finish.</p>}
      <div className="calendar-toolbar">
        <div className="calendar-date">
          <h2>{view === "timeGridWeek"
            ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
              .formatRange(range.start, new Date(+range.end - 1))
            : title || "Your schedule"}</h2>
        </div>
        <div className="calendar-navigation">
            <button
              className="icon-button"
              aria-label="Previous period"
              onClick={() => ref.current?.getApi().prev()}
            >
              <ChevronLeft size={18} />
            </button>
          <button
            className="button compact"
            onClick={() => ref.current?.getApi().today()}
          >
            Today
          </button>
            <button
              className="icon-button"
              aria-label="Next period"
              onClick={() => ref.current?.getApi().next()}
            >
              <ChevronRight size={18} />
            </button>
        </div>
        <div className="segmented">
          {[
            ["timeGridWeek", "Week"],
            ["timeGridDay", "Day"],
            ["dayGridMonth", "Month"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={view === id}
              className={view === id ? "selected" : ""}
              onClick={() => {
                setView(id);
                ref.current?.getApi().changeView(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-scroll">
        <FullCalendar
          className={`study-calendar calendar-${view}`}
          ref={ref}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, classicThemePlugin]}
          initialView="timeGridWeek"
          firstDay={1}
          headerToolbar={false}
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          slotDuration="00:30:00"
          slotHeaderInterval="01:00:00"
          slotHeaderClass="calendar-time-label"
          dayHeaderClass={(info) => `calendar-day-label${info.isToday ? " calendar-day-today" : ""}`}
          height={690}
          nowIndicator
          editable={!busy}
          eventStartEditable={!busy}
          eventDurationEditable={false}
          eventMinHeight={22}
          slotEventOverlap={false}
          eventAllow={(_drop, event) => !busy && event?.extendedProps.type !== "preview" && (event?.extendedProps.type !== "study" ||
            studyBlocks.some(block => block.id === event.extendedProps.blockId && canMoveStudy(block)))}
          eventDrop={(info) => {
            const props = info.event.extendedProps;
            if (props.type === "preview") { info.revert(); return; }
            const startTime = info.event.start;
            if (!startTime || !onMove(props.type === "study"
              ? { type: "study", id: props.blockId, startTime }
              : { type: "fixed", id: props.eventId, occurrenceStart: new Date(props.occurrenceStart), startTime }))
              info.revert();
          }}
          events={calendarEvents}
          dayMaxEvents={3}
          dayHeaderFormat={view === "dayGridMonth" ? { weekday: "short" } : { weekday: "short", day: "numeric" }}
          slotHeaderFormat={{
            hour: "numeric",
            minute: "2-digit",
            omitZeroMinute: true,
            meridiem: "short",
          }}
          eventTimeFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          datesSet={(info) => {
            setTitle(info.view.title);
            setRange((current) =>
              +current.start === +info.start && +current.end === +info.end
                ? current
                : { start: info.start, end: info.end },
            );
          }}
          eventClick={(info) => {
            if (info.event.extendedProps.type === "preview") return;
            if (info.event.extendedProps.type === "study")
              onStudyClick(info.event.extendedProps.blockId);
            else onEventClick(info.event.extendedProps.eventId);
          }}
          eventContent={(info) => {
            const details = [info.event.title,
              info.event.start && dateLabel(info.event.start),
              info.event.end && dateLabel(info.event.end),
              info.event.extendedProps.status ?? "Fixed commitment",
              info.event.extendedProps.topicName,
              info.event.extendedProps.changed && "Updated",
              info.event.extendedProps.previewLabel,
              info.event.extendedProps.moveReason,
            ].filter(Boolean).join(" · ");
            return (
            <div className="calendar-event-content" title={details}
              ref={element => {
                const block = element?.closest(".calendar-event");
                block?.setAttribute("aria-label", details);
                block?.setAttribute("title", info.event.extendedProps.moveReason
                  ? `${info.event.title} — ${info.event.extendedProps.moveReason}` : info.event.title);
              }}>
              <div className="calendar-event-time">{info.timeText}</div>
              <div className="calendar-event-title">{info.event.extendedProps.previewLabel && <span>{info.event.extendedProps.previewLabel} · </span>}{info.event.extendedProps.moveReason && <LockKeyhole className="session-lock-icon" size={12} aria-hidden="true" />}{info.event.extendedProps.changed && <Sparkles className="calendar-update-icon" size={12} aria-hidden="true" />}{info.event.title}</div>
              {info.event.extendedProps.moveReason && <span className="move-reason-text">{info.event.extendedProps.moveReason}</span>}
              {info.event.extendedProps.topicName && <div className="calendar-event-topic">{info.event.extendedProps.topicName}</div>}
              {info.event.extendedProps.changed && <div className="calendar-change-label">Updated</div>}
            </div>
          ); }}
          eventDidMount={(info) => {
            info.el.setAttribute("tabindex", "0");
            if (info.event.extendedProps.type === "preview") {
              info.el.setAttribute("role", "note");
              info.el.setAttribute("data-preview-start", info.event.start?.toISOString() ?? "");
              info.el.setAttribute("data-preview-end", info.event.end?.toISOString() ?? "");
              return;
            }
            info.el.setAttribute("title", info.event.extendedProps.moveReason
              ? `${info.event.title} — ${info.event.extendedProps.moveReason}` : info.event.title);
            info.el.setAttribute("role", "button");
            info.el.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                info.el.click();
              }
            });
          }}
        />
      </div>
      <div className="calendar-footer">
        <div className="legend">
          <span>
            <i className="blue" />
            Commitments
          </span>
          <span>
            <i className="green" />
            Planned study
          </span>
          <span>
            <i className="gray" />
            Completed
          </span>
          <span>
            <i className="orange" />
            Unfinished / skipped
          </span>
        </div>
        <span className="muted small">Drag to move. Sessions with a lock cannot move; hover or open one to see why.</span>
      </div>
    </section>
  );
}
