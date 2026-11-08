import { useMemo, useRef, useState } from "react";
import FullCalendar, { type CalendarRef } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Event, StudyBlock, Task } from "@/datatypes";
import { expandEvents, weekStart } from "@/lib/calendar";

export default function WeeklyCalendar({
  events,
  studyBlocks,
  tasks,
  onStudyClick,
  onEventClick,
}: {
  events: Event[];
  studyBlocks: StudyBlock[];
  tasks: Task[];
  onStudyClick: (id: string) => void;
  onEventClick: (id: string) => void;
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
      ...expandEvents(events, range.start, range.end).map((event) => ({
        id: `fixed:${event.instanceId}`,
        title: event.name,
        start: event.startTime,
        end: event.endTime,
        className: "calendar-event fixed-event",
        color: "#eaf1fc",
        contrastColor: "#4a6b9f",
        extendedProps: { type: "fixed", eventId: event.id },
      })),
      ...studyBlocks.map((block) => ({
        id: `study:${block.id}`,
        title:
          tasks.find((task) => task.id === block.taskId)?.name ??
          "Study session",
        start: block.startTime,
        end: block.endTime,
        color:
          block.status === "completed"
            ? "#eef0f3"
            : block.status === "unfinished"
              ? "#fff1e2"
              : "#e9f4ed",
        contrastColor:
          block.status === "completed"
            ? "#5c6879"
            : block.status === "unfinished"
              ? "#94642b"
              : "#386d52",
        className:
          block.status === "completed"
            ? "calendar-event completed-event"
            : block.status === "unfinished"
              ? "calendar-event unfinished-event"
              : "calendar-event study-event",
        extendedProps: {
          type: "study",
          blockId: block.id,
          status: block.status,
        },
      })),
    ],
    [events, range, studyBlocks, tasks],
  );
  return (
    <section className="calendar-card" aria-label="Study calendar">
      <div className="calendar-toolbar">
        <div className="calendar-date">
          <h2>{title || "Your week"}</h2>
          <div className="calendar-arrows">
            <button
              className="icon-button"
              aria-label="Previous period"
              onClick={() => ref.current?.getApi().prev()}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next period"
              onClick={() => ref.current?.getApi().next()}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            className="button compact"
            onClick={() => ref.current?.getApi().today()}
          >
            Today
          </button>
        </div>
        <div className="segmented">
          {[
            ["timeGridWeek", "Week"],
            ["timeGridDay", "Day"],
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
          plugins={[timeGridPlugin, classicThemePlugin]}
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
          dayHeaderClass="calendar-day-label"
          height={690}
          nowIndicator
          editable={false}
          eventStartEditable={false}
          eventDurationEditable={false}
          events={calendarEvents}
          dayHeaderFormat={{ weekday: "short", day: "numeric" }}
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
            </div>
          )}
          eventDidMount={(info) => {
            info.el.setAttribute("tabindex", "0");
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
            Unfinished
          </span>
        </div>
        <span className="muted small">Click a session to update progress</span>
      </div>
    </section>
  );
}
