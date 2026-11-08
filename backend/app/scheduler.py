"""Deterministic, earliest-first study scheduling using the standard library."""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Iterable, Tuple


@dataclass(frozen=True)
class Assignment:
    title: str
    duration_minutes: int
    due: datetime


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class StudyBlock:
    title: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Schedule:
    blocks: Tuple[StudyBlock, ...]
    unscheduled_minutes: int


def schedule_assignment(
    assignment: Assignment,
    windows: Iterable[Window],
    max_session_minutes: int = 60,
    break_minutes: int = 15,
) -> Schedule:
    """Fill earliest windows, stopping at the deadline or requested duration.

    Overlapping/touching windows are merged. Breaks apply between all blocks,
    including blocks in different windows. All datetimes must be mutually
    comparable (for example, all naive local times).
    """
    for name, value, minimum in (
        ("duration_minutes", assignment.duration_minutes, 0),
        ("max_session_minutes", max_session_minutes, 1),
        ("break_minutes", break_minutes, 0),
    ):
        if type(value) is not int or value < minimum:
            raise ValueError(f"{name} must be an integer >= {minimum}")

    merged = []
    for window in sorted(windows, key=lambda item: item.start):
        if window.end <= window.start:
            raise ValueError("Each window must end after it starts")
        end = min(window.end, assignment.due)
        if end <= window.start:
            continue
        if merged and window.start <= merged[-1].end:
            merged[-1] = Window(merged[-1].start, max(merged[-1].end, end))
        else:
            merged.append(Window(window.start, end))

    blocks = []
    remaining = assignment.duration_minutes
    next_start = None
    for window in merged:
        start = max(window.start, next_start) if next_start else window.start
        while remaining > 0:
            available = (window.end - start) // timedelta(minutes=1)
            minutes = min(remaining, max_session_minutes, available)
            if minutes <= 0:
                break
            end = start + timedelta(minutes=minutes)
            blocks.append(StudyBlock(assignment.title, start, end))
            remaining -= minutes
            next_start = end + timedelta(minutes=break_minutes)
            start = next_start
        if remaining == 0:
            break

    return Schedule(tuple(blocks), remaining)


def replan_assignment(
    assignment: Assignment,
    windows: Iterable[Window],
    existing_blocks: Iterable[StudyBlock],
    remaining_minutes: int,
    now: datetime,
    max_session_minutes: int = 60,
    break_minutes: int = 15,
) -> Schedule:
    """Keep started entries and replace future entries for one assignment.

    ``remaining_minutes`` is the student's current estimate, independent of
    past calendar entries. ``windows`` must be free availability after other
    commitments (such as work shifts) have been removed. Existing blocks must
    belong to this assignment. An entry starting exactly at ``now`` is future;
    an entry already in progress is preserved in full, without inferring credit
    toward the reported remaining work.
    """
    existing = tuple(existing_blocks)
    if any(block.title != assignment.title for block in existing):
        raise ValueError("Existing blocks must belong to this assignment")
    if any(block.end <= block.start for block in existing):
        raise ValueError("Each existing block must end after it starts")
    past = tuple(sorted(
        (block for block in existing if block.start < now),
        key=lambda block: block.start,
    ))
    earliest = max(
        [now] + [block.end + timedelta(minutes=break_minutes) for block in past]
    )
    future_windows = []
    for window in windows:
        if window.end <= window.start:
            raise ValueError("Each window must end after it starts")
        start = max(window.start, earliest)
        if start < window.end:
            future_windows.append(Window(start, window.end))
    future = schedule_assignment(
        replace(assignment, duration_minutes=remaining_minutes),
        future_windows,
        max_session_minutes,
        break_minutes,
    )
    return Schedule(past + future.blocks, future.unscheduled_minutes)
