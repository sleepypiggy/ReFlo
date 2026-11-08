"""Dashboard contract adapter sharing the existing single-assignment engine."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import AwareDatetime, BeforeValidator, Field, StrictInt, model_validator

from .api import InputModel, local_time, timezone_name
from .availability import available_study_windows
from .scheduler import Assignment, Window, schedule_assignment

router = APIRouter(tags=["Dashboard scheduling"])
UTC = timezone.utc
MINUTE = timedelta(minutes=1)


def instant(value: object) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("Use an ISO timestamp with an explicit timezone offset")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
        if not 2 <= result.year <= 9997:
            raise ValueError("Timestamp year must be between 0002 and 9997")
        return result
    except (ValueError, OverflowError):
        raise ValueError("Invalid timestamp") from None


Instant = Annotated[AwareDatetime, BeforeValidator(instant)]
Minutes = Annotated[StrictInt, Field(ge=0)]
DailyMinutes = Annotated[StrictInt, Field(ge=1, le=1440)]
Clock = Annotated[time, BeforeValidator(local_time)]
Identifier = Annotated[str, Field(min_length=1, max_length=200)]


class TaskInput(InputModel):
    id: Identifier
    title: Annotated[str, Field(min_length=1, pattern=r"\S")]
    deadline: Instant
    estimated_minutes: Minutes
    remaining_minutes: Minutes
    grade_weight: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


class EventInput(InputModel):
    id: Identifier
    title: str
    start: Instant
    end: Instant
    repeat_on: list[Annotated[StrictInt, Field(ge=0, le=6)]] = Field(default_factory=list)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("Events must end after they start")
        if self.repeat_on and self.end - self.start > timedelta(days=366):
            raise ValueError("A recurring event cannot last more than 366 days")
        return self


class LockedBlock(InputModel):
    id: Identifier
    task_id: Identifier
    start: Instant
    end: Instant
    status: Literal["planned", "completed", "unfinished"]
    locked: Literal[True]

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("Locked blocks must end after they start")
        return self


class PreferencesInput(InputModel):
    wake_up_time: Clock
    bedtime: Clock
    max_daily_study_minutes: DailyMinutes
    max_session_minutes: DailyMinutes
    break_minutes: Annotated[StrictInt, Field(ge=0, le=1440)]

    @model_validator(mode="after")
    def different_hours(self):
        if self.wake_up_time == self.bedtime:
            raise ValueError("Wake-up and bedtime must differ")
        return self


class ScheduleRequest(InputModel):
    contract_version: Annotated[StrictInt, Field(ge=1, le=1)]
    current_time: Instant
    timezone: Annotated[str, BeforeValidator(timezone_name)]
    tasks: list[TaskInput] = Field(max_length=200)
    events: list[EventInput] = Field(max_length=1000)
    preferences: PreferencesInput
    locked_blocks: list[LockedBlock] = Field(max_length=2000)

    @model_validator(mode="after")
    def references(self):
        for items in (self.tasks, self.events, self.locked_blocks):
            if len({item.id for item in items}) != len(items):
                raise ValueError("IDs must be unique within each collection")
        ids = {task.id for task in self.tasks}
        if any(block.task_id not in ids for block in self.locked_blocks):
            raise ValueError("Locked blocks must reference known task IDs")
        # Bound recurrence expansion and protect datetime arithmetic.
        if not 2 <= self.current_time.year <= 9997:
            raise ValueError("current_time year must be between 0002 and 9997")
        if any(task.deadline > self.current_time + timedelta(days=366) for task in self.tasks):
            raise ValueError("Deadlines must be within 366 days of current_time")
        return self


class ScheduledBlock(InputModel):
    id: str
    task_id: str
    start: datetime
    end: datetime
    status: Literal["planned"] = "planned"


class Shortage(InputModel):
    task_id: str
    minutes: int
    reason: str


class ScheduleResponse(InputModel):
    study_blocks: list[ScheduledBlock]
    unscheduled: list[Shortage]


def ceil_minute(value: datetime) -> datetime:
    floor = value.replace(second=0, microsecond=0)
    return floor if floor == value else floor + MINUTE


def floor_minute(value: datetime) -> datetime:
    return value.replace(second=0, microsecond=0)


def wall(day: date, clock: time, zone: ZoneInfo) -> datetime:
    # A round trip resolves nonexistent local times forward at DST gaps; fold=0
    # chooses the first occurrence of an ambiguous clock time, like browser Date.
    return datetime.combine(day, clock, zone).astimezone(UTC)


def event_windows(request: ScheduleRequest, horizon: datetime) -> list[Window]:
    zone = ZoneInfo(request.timezone)
    result = []
    for event in request.events:
        if not event.repeat_on:
            result.append(Window(event.start, event.end))
            continue
        local_start, local_end = event.start.astimezone(zone), event.end.astimezone(zone)
        day_span = max(0, (local_end.date() - local_start.date()).days)
        first = max(local_start.date(), request.current_time.astimezone(zone).date() - timedelta(days=day_span + 1))
        last = horizon.astimezone(zone).date()
        day = first
        while day <= last:
            if (day.weekday() + 1) % 7 in event.repeat_on:
                start = wall(day, local_start.time(), zone)
                end = wall(day + timedelta(days=day_span), local_end.time(), zone)
                if end <= start:
                    end = wall(day + timedelta(days=day_span + 1), local_end.time(), zone)
                if start >= event.start:
                    result.append(Window(start, end))
            day += timedelta(days=1)
    return result


def subtract(windows: list[Window], occupied: list[Window]) -> list[Window]:
    """Subtract reservations in UTC so elapsed time is correct across DST."""
    result = windows
    for busy in occupied:
        next_windows = []
        for window in result:
            if busy.end <= window.start or busy.start >= window.end:
                next_windows.append(window)
                continue
            if window.start < busy.start:
                next_windows.append(Window(window.start, busy.start))
            if busy.end < window.end:
                next_windows.append(Window(busy.end, window.end))
        result = next_windows
    return result


def minutes_in_day(block: Window, start: datetime, end: datetime) -> float:
    return max(0, (min(block.end, end) - max(block.start, start)).total_seconds() / 60)


@router.post("/schedule", response_model=ScheduleResponse)
def generate_schedule(request: ScheduleRequest) -> ScheduleResponse:
    """Allocate shared availability by earliest deadline, then grade weight/ID.

    Return new sessions only. Locked history remains owned by the frontend.
    Historical entries never imply completed work. Future portions of still-
    planned locked sessions reserve work; completed/unfinished entries do not.
    """
    zone = ZoneInfo(request.timezone)
    preferences = request.preferences
    now = ceil_minute(request.current_time)
    horizon = max([now] + [task.deadline for task in request.tasks])
    fixed = event_windows(request, horizon)
    pause = timedelta(minutes=preferences.break_minutes)
    reservations = [Window(block.start, block.end) for block in request.locked_blocks]
    occupied = [Window(block.start - pause, block.end + pause) for block in reservations]
    output = []
    warnings = []
    used_ids = {block.id for block in request.locked_blocks}
    for task in sorted(request.tasks, key=lambda item: (item.deadline, -item.grade_weight, item.id)):
        reserved = sum(max(0, int((block.end - max(block.start, request.current_time)).total_seconds() // 60))
                       for block in request.locked_blocks
                       if block.task_id == task.id and block.status == "planned")
        remaining = max(0, task.remaining_minutes - reserved)
        day = now.astimezone(zone).date()
        last_day = task.deadline.astimezone(zone).date()
        while remaining and day <= last_day:
            midnight = wall(day, time.min, zone)
            next_midnight = wall(day + timedelta(days=1), time.min, zone)
            day_start, day_end = max(now, midnight), min(task.deadline, next_midnight)
            if day_start < day_end:
                # Calculate normal waking hours with the teammate's function.
                # Overnight waking hours are split around local midnight.
                wake, bed = preferences.wake_up_time, preferences.bedtime
                if wake < bed:
                    local_windows = available_study_windows(
                        day_start.astimezone(zone), day_end.astimezone(zone), wake, bed, [],
                    )
                    windows = [Window(item.start.astimezone(UTC), item.end.astimezone(UTC)) for item in local_windows]
                else:
                    windows = [Window(day_start, min(day_end, wall(day, bed, zone))),
                               Window(max(day_start, wall(day, wake, zone)), day_end)]
                    windows = [item for item in windows if item.start < item.end]
                windows = subtract(windows, fixed + occupied)
                windows = [Window(ceil_minute(item.start), floor_minute(item.end)) for item in windows]
                windows = [item for item in windows if item.start < item.end]
                used = sum(minutes_in_day(item, midnight, next_midnight) for item in reservations)
                capacity = max(0, int(preferences.max_daily_study_minutes - used))
                result = schedule_assignment(
                    Assignment(task.title, min(remaining, capacity), task.deadline), windows,
                    preferences.max_session_minutes, preferences.break_minutes,
                )
                for block in result.blocks:
                    identifier = str(uuid4())
                    while identifier in used_ids:
                        identifier = str(uuid4())
                    used_ids.add(identifier)
                    output.append(ScheduledBlock(id=identifier, task_id=task.id, start=block.start, end=block.end))
                    reservation = Window(block.start, block.end)
                    reservations.append(reservation)
                    occupied.append(Window(block.start - pause, block.end + pause))
                    remaining -= int((block.end - block.start).total_seconds() // 60)
            day += timedelta(days=1)
        if remaining:
            warnings.append(Shortage(task_id=task.id, minutes=remaining,
                                    reason="Not enough free study time before the deadline under your preferences."))
    return ScheduleResponse(study_blocks=sorted(output, key=lambda block: (block.start, block.id)), unscheduled=warnings)
