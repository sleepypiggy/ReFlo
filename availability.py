"""Build free study windows without scheduling work or changing input data."""

from datetime import datetime, time, timedelta
from typing import Iterable, Tuple

from scheduler import Window


def available_study_windows(
    planning_start: datetime,
    planning_end: datetime,
    wake_up: time,
    bedtime: time,
    fixed_events: Iterable[Window],
) -> Tuple[Window, ...]:
    """Subtract fixed events from daily waking hours within a planning range.

    The range, daily hours, and events are half-open [start, end) intervals.
    Daily hours must be same-day: wake_up < bedtime. Times must have no tzinfo;
    they are interpreted in planning_start's timezone. Range endpoints and event
    endpoints must either all be naive local datetimes or all be timezone-aware.
    Aware range endpoints must share a timezone; aware events may use other
    offsets. The caller should supply a ZoneInfo timezone for local daily hours
    across daylight-saving changes, rather than a fixed UTC offset.

    Returns sorted, nonempty Window objects, clipped to the range. Overlapping,
    duplicate, and touching events are treated as one continuous commitment.
    No session limits or break padding are applied; those belong to scheduler.py.
    This function has no I/O and does not mutate its inputs.
    """
    if wake_up.tzinfo is not None or bedtime.tzinfo is not None:
        raise ValueError("wake_up and bedtime must be local times without tzinfo")
    if wake_up >= bedtime:
        raise ValueError("Daily hours must satisfy wake_up < bedtime (same day)")
    aware = planning_start.utcoffset() is not None

    def check_awareness(value: datetime) -> None:
        if (value.utcoffset() is not None) != aware:
            raise ValueError("All datetimes must be consistently naive or timezone-aware")

    check_awareness(planning_end)
    if planning_start.tzinfo != planning_end.tzinfo:
        raise ValueError("Planning endpoints must share a timezone")
    if planning_end <= planning_start:
        raise ValueError("planning_end must be after planning_start")

    events = tuple(fixed_events)
    for event in events:
        check_awareness(event.start)
        check_awareness(event.end)
        if event.end <= event.start:
            raise ValueError("Each fixed event must end after it starts")
    events = sorted(events, key=lambda event: event.start)

    windows = []
    day = planning_start.date()
    while day <= planning_end.date():
        start = max(planning_start, datetime.combine(day, wake_up, planning_start.tzinfo))
        end = min(planning_end, datetime.combine(day, bedtime, planning_start.tzinfo))
        if start < end:
            cursor = start
            for event in events:
                if event.end <= cursor:
                    continue
                if event.start >= end:
                    break
                if event.start > cursor:
                    windows.append(Window(cursor, event.start))
                cursor = max(cursor, event.end)
                if cursor >= end:
                    break
            if cursor < end:
                windows.append(Window(cursor, end))
        if day == planning_end.date():
            break
        day += timedelta(days=1)
    return tuple(windows)
