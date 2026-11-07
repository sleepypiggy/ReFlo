"""Run a repeatable Replan study-scheduling example."""

from datetime import datetime

from scheduler import Assignment, Schedule, Window, replan_assignment, schedule_assignment


def print_result(label: str, result: Schedule, now: datetime = None) -> None:
    print(f"\n{label}")
    future_minutes = 0
    for block in result.blocks:
        minutes = int((block.end - block.start).total_seconds() // 60)
        past = now is not None and block.start < now
        if not past:
            future_minutes += minutes
        suffix = " [preserved]" if past else ""
        print(f"{block.start:%A %I:%M %p}–{block.end:%I:%M %p} ({minutes} minutes){suffix}")
    print(f"{'Future scheduled' if now else 'Scheduled'} minutes: {future_minutes}")
    print(f"Unscheduled minutes: {result.unscheduled_minutes}")


def main() -> None:
    assignment = Assignment(
        title="Statistics assignment",
        duration_minutes=240,
        due=datetime(2026, 11, 12, 19, 15),
    )
    windows = [
        Window(datetime(2026, 11, 10, 16), datetime(2026, 11, 10, 18, 15)),
        Window(datetime(2026, 11, 11, 9), datetime(2026, 11, 11, 11, 15)),
        Window(datetime(2026, 11, 12, 18, 15), datetime(2026, 11, 12, 19, 15)),
    ]
    baseline = schedule_assignment(assignment, windows)
    print(assignment.title)
    print(f"Due: {assignment.due:%A %Y-%m-%d %I:%M %p}")
    print_result("1. Original 240-minute plan", baseline)

    now = datetime(2026, 11, 10, 20)
    replanned = replan_assignment(assignment, windows, baseline.blocks, 180, now)
    print_result("2. Tuesday evening: 180 minutes still needed", replanned, now)

    # The new shift occupies all of Thursday's availability.
    revised = replan_assignment(assignment, windows[:2], replanned.blocks, 180, now)
    print_result("3. Thursday work shift removes its study window", revised, now)

    def future_by_day(result: Schedule):
        totals = {}
        for block in result.blocks:
            if block.start >= now:
                day = block.start.strftime("%A")
                totals[day] = totals.get(day, 0) + int(
                    (block.end - block.start).total_seconds() // 60
                )
                assert block.end <= assignment.due
        return totals

    assert len(baseline.blocks) == 4
    assert all((b.end - b.start).total_seconds() == 3600 for b in baseline.blocks)
    assert [b.start.weekday() for b in baseline.blocks] == [1, 1, 2, 2]
    assert baseline.unscheduled_minutes == 0
    assert replanned.blocks[:2] == revised.blocks[:2] == baseline.blocks[:2]
    assert future_by_day(replanned) == {"Wednesday": 120, "Thursday": 60}
    assert replanned.unscheduled_minutes == 0
    assert future_by_day(revised) == {"Wednesday": 120}
    assert revised.unscheduled_minutes == 60
    print("\nAll three scenarios verified.")


if __name__ == "__main__":
    main()
