import { useMemo, useRef, useState } from "react";
import FullCalendar, { type CalendarRef } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Event, StudyBlock, Task, Topic } from "@/datatypes";
import { expandEvents, weekStart } from "@/lib/calendar";
import { colorPalette } from "@/lib/topics";
import { canMoveStudy, type CalendarMove } from "@/lib/calendarMoves";

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
}) {
  const ref = useRef<CalendarRef>(null);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("timeGridWeek");
  const [range, setRange] = useState(() => {
    const start = weekStart();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  });
  const calendarEvents = useMemo(
    () => [
      ...expandEvents(events, range.start, range.end).map((event) => {
        const topic = topics.find((topic) => topic.id === event.topicId);
        const color = topic?.color ?? event.color;
        const palette = color ? colorPalette(color) : null;
        return {
        id: `fixed:${event.instanceId}`,
        title: event.name,
        start: event.startTime,
        end: event.endTime,
        className: `calendar-event fixed-event${color ? " topic-study" : ""}`,
        color: palette?.background ?? "var(--lecture-bg)",
        contrastColor: palette?.foreground ?? "var(--lecture-ink)",
        extendedProps: { type: "fixed", eventId: event.id, occurrenceStart: event.startTime, topicName: topic?.name },
      };
      }),
      ...studyBlocks.map((block) => {
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
        startEditable: canMoveStudy(block),
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
        },
      };
      }),
    ],
    [events, range, studyBlocks, tasks, topics, changedBlockIds],
  );
  return (
    <section className="calendar-card" aria-label="Study calendar">
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
          eventAllow={(_drop, event) => !busy && (event?.extendedProps.type !== "study" ||
            studyBlocks.some(block => block.id === event.extendedProps.blockId && canMoveStudy(block)))}
          eventDrop={(info) => {
            const props = info.event.extendedProps;
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
            if (info.event.extendedProps.type === "study")
              onStudyClick(info.event.extendedProps.blockId);
            else onEventClick(info.event.extendedProps.eventId);
          }}
          eventContent={(info) => (
            <div className="calendar-event-content">
              <div className="calendar-event-time">{info.timeText}</div>
              <div className="calendar-event-title">{info.event.title}</div>
              {info.event.extendedProps.changed && <div className="calendar-change-label">Updated</div>}
              {info.event.extendedProps.topicName && <div className="calendar-event-topic">{info.event.extendedProps.topicName}</div>}
            </div>
          )}
          eventDidMount={(info) => {
            info.el.setAttribute("tabindex", "0");
            info.el.setAttribute("title", info.event.title);
            info.el.setAttribute("role", "button");
            info.el.setAttribute(
              "aria-label",
              `${info.event.title}, ${info.event.extendedProps.status ?? "fixed commitment"}`,
            );
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
        <span className="muted small">Drag to move; click a session to update progress</span>
      </div>
    </section>
  );
}
