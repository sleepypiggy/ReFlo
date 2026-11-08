"""Validated HTTP adapter for the single-assignment scheduling engine."""

import re
from datetime import datetime, time, timezone
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictInt, model_validator

from .availability import available_study_windows
from .scheduler import Assignment, StudyBlock, Window, replan_assignment

router = APIRouter(prefix="/api", tags=["Planning"])


def timestamp(value: object) -> datetime:
    """Preserve the prototype's minute precision and normalize to UTC."""
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("Use YYYY-MM-DDTHH:MM:00Z or an explicit ±HH:MM offset")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ValueError("Invalid or out-of-range timestamp") from None


Timestamp = Annotated[datetime, BeforeValidator(timestamp)]
NonnegativeMinutes = Annotated[StrictInt, Field(ge=0)]
PositiveMinutes = Annotated[StrictInt, Field(ge=1)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Interval(InputModel):
    start: Timestamp
    end: Timestamp

    @model_validator(mode="after")
    def check_order(self):
        if self.end <= self.start:
            raise ValueError("Intervals must end after they start")
        return self


class ExistingBlock(Interval):
    title: str


class AssignmentInput(InputModel):
    title: Annotated[str, Field(min_length=1, pattern=r"\S")]
    deadline: Timestamp


def local_time(value: object) -> time:
    if not isinstance(value, str) or not re.fullmatch(r"\d{2}:\d{2}", value):
        raise ValueError("Use a local time in HH:mm format")
    return time.fromisoformat(value)


def timezone_name(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Use an IANA timezone string")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Use a valid IANA timezone such as America/Vancouver") from None
    return value


class AvailabilityInput(InputModel):
    timezone: Annotated[str, BeforeValidator(timezone_name)]
    wake_up: Annotated[time, BeforeValidator(local_time)]
    bedtime: Annotated[time, BeforeValidator(local_time)]
    fixed_events: list[Interval]

    @model_validator(mode="after")
    def check_daily_hours(self):
        if self.wake_up >= self.bedtime:
            raise ValueError("Daily hours must satisfy wake_up < bedtime (same day)")
        return self


class PlanRequest(InputModel):
    assignment: AssignmentInput
    remaining_minutes: NonnegativeMinutes
    now: Timestamp
    existing_blocks: list[ExistingBlock]
    available_windows: list[Interval]
    max_session_minutes: PositiveMinutes
    break_minutes: NonnegativeMinutes
    availability: AvailabilityInput | None = None

    @model_validator(mode="after")
    def check_assignment_titles(self):
        if any(block.title != self.assignment.title for block in self.existing_blocks):
            raise ValueError("Existing blocks must have the assignment title")
        return self


class BlockResponse(BaseModel):
    title: str
    start: datetime
    end: datetime


class PlanResponse(BaseModel):
    past_blocks: list[BlockResponse]
    future_blocks: list[BlockResponse]
    future_scheduled_minutes: int
    unscheduled_minutes: int


def free_windows(request: PlanRequest) -> list[Window]:
    windows = [Window(item.start, item.end) for item in request.available_windows]
    settings = request.availability
    if settings is None:
        return windows
    zone = ZoneInfo(settings.timezone)
    events = [Window(item.start, item.end) for item in settings.fixed_events]
    result = []
    for window in windows:
        local_windows = available_study_windows(
            window.start.astimezone(zone), window.end.astimezone(zone),
            settings.wake_up, settings.bedtime, events,
        )
        result.extend(Window(
            item.start.astimezone(timezone.utc), item.end.astimezone(timezone.utc)
        ) for item in local_windows)
    return result


@router.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    """Schedule or replan one assignment, retaining already-started entries.

    Without availability settings, available_windows must already exclude fixed
    events and sleep. With settings, the availability function filters them first.
    Timestamps in responses are UTC; remaining work excludes no inferred credit.
    """
    try:
        result = replan_assignment(
            Assignment(request.assignment.title, request.remaining_minutes, request.assignment.deadline),
            free_windows(request),
            [StudyBlock(item.title, item.start, item.end) for item in request.existing_blocks],
            request.remaining_minutes, request.now, request.max_session_minutes, request.break_minutes,
        )
    except (ValueError, OverflowError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    def block_response(block: StudyBlock) -> BlockResponse:
        return BlockResponse(title=block.title, start=block.start, end=block.end)

    past = [block for block in result.blocks if block.start < request.now]
    future = [block for block in result.blocks if block.start >= request.now]
    return PlanResponse(
        past_blocks=[block_response(block) for block in past],
        future_blocks=[block_response(block) for block in future],
        future_scheduled_minutes=sum(
            int((block.end - block.start).total_seconds() // 60) for block in future
        ),
        unscheduled_minutes=result.unscheduled_minutes,
    )
