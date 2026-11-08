"""Deadline-aware dashboard allocation using the shared session engine."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from fractions import Fraction
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import AwareDatetime, BeforeValidator, Field, StrictBool, StrictInt, model_validator

from .api import InputModel, local_time, timezone_name
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
    exclude_starts: list[Instant] = Field(default_factory=list, max_length=2000)

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
    max_session_minutes: Annotated[StrictInt, Field(ge=15, le=1440)]
    break_minutes: Annotated[StrictInt, Field(ge=0, le=1440)]
    spread_assignments: StrictBool = True

    @model_validator(mode="after")
    def different_hours(self):
        if self.wake_up_time < time(6):
            raise ValueError("Wake-up time must be 06:00 or later")
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
                if start >= event.start and start not in event.exclude_starts:
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
    daily_limit: int | None = None, task_daily_limits: dict[str, int] | None = None,
    session_gap: int | None = None,
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
    gap = max(preferences.break_minutes, session_gap or 0)
    new_pause = timedelta(minutes=gap)
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
            day_start, day_end = max(now, wall(day, time(6), zone)), min(task.deadline, next_midnight)
            if day_start < day_end:
                # Compare instants in UTC: local datetime ordering ignores fold
                # when both endpoints share a ZoneInfo at the fall-back hour.
                # Overnight waking hours are split around local midnight.
                wake, bed = preferences.wake_up_time, preferences.bedtime
                key = (day_start, day_end)
                if key in availability:
                    windows = availability[key]
                elif wake < bed:
                    windows = [Window(max(day_start, wall(day, wake, zone)),
                                      min(day_end, wall(day, bed, zone)))]
                    windows = [item for item in windows if item.start < item.end]
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
                capacity = max(0, int((daily_limit or preferences.max_daily_study_minutes) - used))
                if task_daily_limits is not None:
                    capacity = min(capacity, task_daily_limits.get(task.id, remaining))
                result = schedule_assignment(
                    Assignment(task.title, min(remaining, capacity), task.deadline), windows,
                    preferences.max_session_minutes, gap,
                    min_session_minutes=15,
                )
                for block in result.blocks:
                    output.append((task.id, block.start, block.end))
                    reservation = Window(block.start, block.end)
                    reservations.append(reservation)
                    occupied.append(Window(block.start - new_pause, block.end + new_pause))
                    remaining -= int((block.end - block.start).total_seconds() // 60)
            day += timedelta(days=1)
    return output


def _totals(blocks: list[tuple[str, datetime, datetime]]) -> dict[str, int]:
    totals = {}
    for task_id, start, end in blocks:
        totals[task_id] = totals.get(task_id, 0) + int((end - start) // MINUTE)
    return totals


def _space_dayparts(request: ScheduleRequest, blocks: list[tuple[str, datetime, datetime]], availability: dict):
    """Vary sessions between local morning, afternoon and evening when feasible.

    Keep each session's task, duration and local date, so daily balance and work
    accounting are unchanged. Every day has its known feasible plan as fallback.
    """
    zone = ZoneInfo(request.timezone)
    preferences = request.preferences
    now = ceil_minute(request.current_time)
    minimum_break = timedelta(minutes=preferences.break_minutes)
    tasks = {task.id: task for task in request.tasks}
    grouped = {}
    ordinals, counts = {}, {}
    for block in sorted(blocks, key=lambda item: (item[1], item[0], item[2])):
        grouped.setdefault(block[1].astimezone(zone).date(), []).append(block)
        ordinals[block] = counts.get(block[0], 0)
        counts[block[0]] = ordinals[block] + 1
    history = [Window(block.start - (minimum_break if block.status != "skipped" else timedelta()),
                      block.end + (minimum_break if block.status != "skipped" else timedelta()))
               for block in request.locked_blocks]
    fixed = availability.get("fixed", [])
    result = []
    for day, original in sorted(grouped.items()):
        midnight = wall(day, time.min, zone)
        tomorrow = wall(day + timedelta(days=1), time.min, zone)
        start, end = max(now, wall(day, time(6), zone)), tomorrow
        wake, bed = preferences.wake_up_time, preferences.bedtime
        if wake < bed:
            windows = [Window(max(start, wall(day, wake, zone)), min(end, wall(day, bed, zone)))]
            windows = [window for window in windows if window.start < window.end]
        else:
            windows = [Window(start, min(end, wall(day, bed, zone))),
                       Window(max(start, wall(day, wake, zone)), end)]
            windows = [window for window in windows if window.start < window.end]
        # Protect original neighboring days, even if their sessions move later.
        # This ensures keeping a day's old placement is always a safe fallback.
        other_days = [Window(block_start - minimum_break, block_end + minimum_break)
                      for _, block_start, block_end in blocks if block_start.astimezone(zone).date() != day]
        previous_days = [Window(block_start - minimum_break, block_end + minimum_break)
                         for _, block_start, block_end in result]
        free = subtract(windows, fixed + history + other_days + previous_days)
        parts = [(midnight, wall(day, time(12), zone)),
                 (wall(day, time(12), zone), wall(day, time(17), zone)),
                 (wall(day, time(17), zone), tomorrow)]
        ordered = sorted(original, key=lambda item: (tasks[item[0]].deadline, item[0], item[1]))

        def arrange(gap_minutes):
            occupied = []
            placed = []
            loads = [sum(minutes_in_day(Window(block.start, block.end), part_start, part_end)
                         for block in request.locked_blocks if block.status != "skipped")
                     for part_start, part_end in parts]
            pause = timedelta(minutes=gap_minutes)
            for block in ordered:
                task_id, old_start, old_end = block
                duration = old_end - old_start
                candidates = []
                for index, (part_start, part_end) in enumerate(parts):
                    for window in subtract(free, occupied):
                        candidate_start = ceil_minute(max(window.start, part_start))
                        candidate_end = candidate_start + duration
                        if candidate_end <= min(window.end, part_end, tasks[task_id].deadline):
                            candidates.append((index, candidate_start, candidate_end))
                if not candidates:
                    return None
                usable = sorted({candidate[0] for candidate in candidates})
                preferred = usable[ordinals[block] % len(usable)]
                index, selected_start, selected_end = min(candidates, key=lambda item: (
                    loads[item[0]], (item[0] - preferred) % 3, item[1], item[2],
                ))
                placed.append((task_id, selected_start, selected_end))
                occupied.append(Window(selected_start - pause, selected_end + pause))
                loads[index] += int(duration // MINUTE)
            return placed

        placed = arrange(max(60, preferences.break_minutes))
        if placed is None:
            placed = arrange(preferences.break_minutes)
        result.extend(original if placed is None else placed)
    return result


def _spread(request: ScheduleRequest, packed: list[tuple[str, datetime, datetime]], availability: dict):
    """Soft spacing only: never change the admitted minutes for any task.

    Balance daily workload, then each assignment's daily share. Finally try up
    to an hour between new study sessions and vary their local dayparts.
    Keep a known feasible plan whenever
    a spacing trial fails; tight deadlines can still require consecutive work.
    """
    budgets = _totals(packed)
    if not budgets or not request.preferences.spread_assignments:
        return packed
    zone = ZoneInfo(request.timezone)
    today = ceil_minute(request.current_time).astimezone(zone).date()
    tasks = [task for task in request.tasks if budgets.get(task.id)]
    multi_day = any(task.deadline.astimezone(zone).date() > today for task in tasks)

    def trial(limit=None, shares=None, gap=None):
        blocks = _allocate(request, budgets, availability, limit, shares, gap)
        return blocks if _totals(blocks) == budgets else None

    chosen = packed
    cap = request.preferences.max_daily_study_minutes
    if multi_day:
        # Avoid fragmenting a small assignment into minute-long daily sessions.
        lower = min(cap, request.preferences.max_session_minutes, 30)
        upper = cap
        while lower < upper:
            middle = (lower + upper) // 2
            candidate = trial(middle)
            if candidate is None:
                lower = middle + 1
            else:
                upper = middle
                chosen = candidate
        cap = upper
        candidate = trial(cap)
        if candidate is not None:
            chosen = candidate
        else:
            cap = request.preferences.max_daily_study_minutes

    targets = {}
    for task in tasks:
        days = max(1, (task.deadline.astimezone(zone).date() - today).days + 1)
        budget = budgets[task.id]
        targets[task.id] = min(budget, max(min(30, request.preferences.max_session_minutes), (budget + days - 1) // days))

    def shares_at(percent):
        return {id: value + ((budgets[id] - value) * percent + 99) // 100 for id, value in targets.items()}

    shares = None
    if multi_day:
        candidate = trial(cap, targets)
        if candidate is not None:
            chosen, shares = candidate, targets
        else:
            # Relax assignment shares until the known admitted work still fits.
            lower, upper = 1, 100
            while lower < upper:
                middle = (lower + upper) // 2
                candidate = trial(cap, shares_at(middle))
                if candidate is None:
                    lower = middle + 1
                else:
                    upper = middle
            candidate = trial(cap, shares_at(upper))
            if candidate is not None:
                chosen, shares = candidate, shares_at(upper)

    gap = max(60, request.preferences.break_minutes)
    candidate = trial(cap, shares, gap)
    if candidate is not None:
        chosen = candidate
    return _space_dayparts(request, chosen, availability)


def _tidy_durations(request: ScheduleRequest, blocks: list[tuple[str, datetime, datetime]], availability: dict):
    """Prefer five-minute durations without changing task totals or start times.

    Transfer at most four minutes between two new sessions of the same task.
    Keep exact odd totals and constrained placements when rounding cannot fit.
    Locked history is never changed.
    """
    result = list(blocks)
    zone = ZoneInfo(request.timezone)
    preferences = request.preferences
    tasks = {task.id: task for task in request.tasks}
    pause = timedelta(minutes=preferences.break_minutes)
    fixed = availability.get("fixed", [])
    history = [Window(block.start - (pause if block.status != "skipped" else timedelta()),
                      block.end + (pause if block.status != "skipped" else timedelta()))
               for block in request.locked_blocks]

    def valid_extension(index):
        task_id, start, end = result[index]
        day = start.astimezone(zone).date()
        midnight = wall(day, time.min, zone)
        tomorrow = wall(day + timedelta(days=1), time.min, zone)
        wake, bed = preferences.wake_up_time, preferences.bedtime
        if wake < bed:
            waking = [Window(wall(day, wake, zone), wall(day, bed, zone))]
        else:
            waking = [Window(midnight, wall(day, bed, zone)),
                      Window(wall(day, wake, zone), tomorrow)]
        if end > tasks[task_id].deadline or not any(window.start <= start < end <= window.end for window in waking):
            return False
        occupied = fixed + history + [Window(other_start - pause, other_end + pause)
                                     for other_index, (_, other_start, other_end) in enumerate(result)
                                     if other_index != index]
        if any(window.start < end and window.end > start for window in occupied):
            return False
        used = sum(minutes_in_day(Window(other_start, other_end), midnight, tomorrow)
                   for _, other_start, other_end in result)
        used += sum(minutes_in_day(Window(block.start, block.end), midnight, tomorrow)
                    for block in request.locked_blocks if block.status != "skipped")
        return used <= preferences.max_daily_study_minutes

    for index in range(len(result)):
        task_id, start, end = result[index]
        duration = int((end - start) // MINUTE)
        remainder = duration % 5
        if not remainder:
            continue
        # Prefer the smallest adjustment, rounding down on equal distance.
        for delta in sorted((-remainder, 5 - remainder), key=lambda value: (abs(value), value)):
            if not 15 <= duration + delta <= preferences.max_session_minutes:
                continue
            adjusted = False
            for other_index, other in enumerate(result):
                other_task, other_start, other_end = other
                other_duration = int((other_end - other_start) // MINUTE)
                if other_index == index or other_task != task_id or other_duration % 5 == 0:
                    continue
                if not 15 <= other_duration - delta <= preferences.max_session_minutes:
                    continue
                result[index] = (task_id, start, end + delta * MINUTE)
                result[other_index] = (task_id, other_start, other_end - delta * MINUTE)
                # Shortening is always safe; validate only the extended session.
                if valid_extension(index if delta > 0 else other_index):
                    adjusted = True
                    break
                result[index] = (task_id, start, end)
                result[other_index] = other
            if adjusted:
                break
    return result


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
                # Budgets below the minimum block length are deliberately
                # infeasible; do not binary-search through that initial gap.
                lower = 15
                if upper < lower or not fits({**admitted, task.id: lower}):
                    admitted[task.id] = 0
                    continue
                while lower < upper:
                    middle = (lower + upper + 1) // 2
                    if fits({**admitted, task.id: middle}):
                        lower = middle
                    else:
                        upper = middle - 1
                upper = lower
            admitted[task.id] = upper
        output = _allocate(request, admitted, availability)

    output = _spread(request, output, availability)
    output = _tidy_durations(request, output, availability)
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
                        reason=("Remaining unscheduled work is below the 15-minute minimum study block; "
                                "your work estimate has not been rounded up."
                                if demand[task.id] - scheduled.get(task.id, 0) < 15 else
                                "Work could not be placed before the deadline with a 15-minute minimum study block under your preferences and priority policy."))
                for task in tasks if demand[task.id] > scheduled.get(task.id, 0)]
    return ScheduleResponse(study_blocks=result, unscheduled=warnings)
