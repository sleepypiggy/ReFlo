"""Deadline-aware dashboard allocation using the shared session engine."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from fractions import Fraction
from uuid import NAMESPACE_URL, uuid5
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
    status: Literal["planned", "completed", "unfinished", "skipped"]
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


def _allocate(
    request: ScheduleRequest, budgets: dict[str, int], availability: dict,
) -> list[tuple[str, datetime, datetime]]:
    """Pack minute budgets in deadline order, preserving all constraints.

    Return new sessions only. Locked history remains owned by the frontend.
    Historical entries never imply completed work. Future portions of still-
    planned locked sessions reserve work; completed/unfinished entries do not.
    """
    zone = ZoneInfo(request.timezone)
    preferences = request.preferences
    now = ceil_minute(request.current_time)
    horizon = max([now] + [task.deadline for task in request.tasks])
    if "fixed" not in availability:
        availability["fixed"] = event_windows(request, horizon)
    fixed = availability["fixed"]
    pause = timedelta(minutes=preferences.break_minutes)
    # Skipped history is occupancy, not time actually spent studying.
    reservations = [Window(block.start, block.end) for block in request.locked_blocks if block.status != "skipped"]
    occupied = [Window(block.start - (pause if block.status != "skipped" else timedelta()),
                       block.end + (pause if block.status != "skipped" else timedelta()))
                for block in request.locked_blocks]
    output = []
    for task in sorted(request.tasks, key=lambda item: (item.deadline, item.id)):
        remaining = budgets.get(task.id, 0)
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
                key = (day_start, day_end)
                if key in availability:
                    windows = availability[key]
                elif wake < bed:
                    local_windows = available_study_windows(
                        day_start.astimezone(zone), day_end.astimezone(zone), wake, bed, [],
                    )
                    windows = [Window(item.start.astimezone(UTC), item.end.astimezone(UTC)) for item in local_windows]
                else:
                    windows = [Window(day_start, min(day_end, wall(day, bed, zone))),
                               Window(max(day_start, wall(day, wake, zone)), day_end)]
                    windows = [item for item in windows if item.start < item.end]
                if key not in availability:
                    availability[key] = subtract(windows, fixed)
                windows = subtract(availability[key], occupied)
                windows = [Window(ceil_minute(item.start), floor_minute(item.end)) for item in windows]
                windows = [item for item in windows if item.start < item.end]
                used = sum(minutes_in_day(item, midnight, next_midnight) for item in reservations)
                capacity = max(0, int(preferences.max_daily_study_minutes - used))
                result = schedule_assignment(
                    Assignment(task.title, min(remaining, capacity), task.deadline), windows,
                    preferences.max_session_minutes, preferences.break_minutes,
                )
                for block in result.blocks:
                    output.append((task.id, block.start, block.end))
                    reservation = Window(block.start, block.end)
                    reservations.append(reservation)
                    occupied.append(Window(block.start - pause, block.end + pause))
                    remaining -= int((block.end - block.start).total_seconds() // 60)
            day += timedelta(days=1)
    return output


def _totals(blocks: list[tuple[str, datetime, datetime]]) -> dict[str, int]:
    totals = {}
    for task_id, start, end in blocks:
        totals[task_id] = totals.get(task_id, 0) + int((end - start) // MINUTE)
    return totals


@router.post("/schedule", response_model=ScheduleResponse)
def generate_schedule(request: ScheduleRequest) -> ScheduleResponse:
    """Try all work in deadline order, then admit work by weighted pressure.

    The session packer is a feasibility heuristic with nonzero breaks, not a
    global optimizer. Admission preserves the budgets of higher-ranked tasks.
    See frontend/API_CONTRACT.md for the policy and its guarantees and limits.
    """
    tasks = sorted(request.tasks, key=lambda task: (task.deadline, task.id))
    demand = {}
    for task in tasks:
        reserved = sum(max(0, int((block.end - max(block.start, request.current_time)) // MINUTE))
                       for block in request.locked_blocks
                       if block.task_id == task.id and block.status == "planned")
        demand[task.id] = max(0, task.remaining_minutes - reserved)

    # Availability is immutable across trials; reservations are trial-local.
    availability = {}
    output = _allocate(request, demand, availability)
    if _totals(output) != {key: value for key, value in demand.items() if value}:
        # Measure standalone capacity under the same preferences and history.
        # A bounded horizon means no task can use more than 367 days of minutes.
        capacity = {}
        capacity_by_deadline = {}
        for task in tasks:
            if not demand[task.id]:
                continue
            if task.deadline not in capacity_by_deadline:
                capacity_by_deadline[task.deadline] = sum(
                    _totals(_allocate(request, {task.id: 367 * 1440}, availability)).values()
                )
            capacity[task.id] = capacity_by_deadline[task.deadline]

        def priority(task):
            pressure = Fraction(demand[task.id], max(1, capacity[task.id]))
            score = Fraction(str(task.grade_weight)) * pressure
            return (-score, task.deadline, -pressure, task.id)

        def fits(budgets):
            return _totals(_allocate(request, budgets, availability)) == {key: value for key, value in budgets.items() if value}

        admitted = {}
        for task in sorted((task for task in tasks if demand[task.id]), key=priority):
            if not capacity[task.id]:
                continue
            upper = min(demand[task.id], capacity[task.id])
            if not fits({**admitted, task.id: upper}):
                lower = 0
                while lower < upper:
                    middle = (lower + upper + 1) // 2
                    if fits({**admitted, task.id: middle}):
                        lower = middle
                    else:
                        upper = middle - 1
                upper = lower
            admitted[task.id] = upper
        output = _allocate(request, admitted, availability)

    used_ids = {block.id for block in request.locked_blocks}
    result = []
    for task_id, start, end in sorted(output, key=lambda block: (block[1], block[0], block[2])):
        # Identical requests produce identical responses, including IDs.
        name = f"{task_id}/{start.isoformat()}/{end.isoformat()}"
        identifier = str(uuid5(NAMESPACE_URL, name))
        suffix = 0
        while identifier in used_ids:
            suffix += 1
            identifier = str(uuid5(NAMESPACE_URL, f"{name}/{suffix}"))
        used_ids.add(identifier)
        result.append(ScheduledBlock(id=identifier, task_id=task_id, start=start, end=end))
    scheduled = _totals(output)
    warnings = [Shortage(task_id=task.id, minutes=demand[task.id] - scheduled.get(task.id, 0),
                        reason="Work could not be placed before the deadline under your current preferences.")
                for task in tasks if demand[task.id] > scheduled.get(task.id, 0)]
    return ScheduleResponse(study_blocks=result, unscheduled=warnings)
