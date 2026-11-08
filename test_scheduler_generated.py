"""Seeded dashboard invariants. Failure subtests include the complete JSON request."""

import copy
import json
import random
import unittest
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from itertools import permutations
from zoneinfo import ZoneInfo

from backend.app.schedule_api import ScheduleRequest, generate_schedule

MINUTE = timedelta(minutes=1)
UTC = timezone.utc
SEEDS = (104729, 20261108, 8675309)


def parse(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def overlaps(start, end, other_start, other_end):
    return start < other_end and end > other_start


def recurring_occurrences(data):
    """Small independent date expansion, never calling production availability."""
    zone = ZoneInfo(data["timezone"])
    now = parse(data["current_time"])
    horizon = max([now] + [parse(task["deadline"]) for task in data["tasks"]])
    output = []
    for event in data["events"]:
        start, end = parse(event["start"]), parse(event["end"])
        if not event.get("repeat_on"):
            output.append((start, end))
            continue
        local_start, local_end = start.astimezone(zone), end.astimezone(zone)
        day = local_start.date()
        while day <= horizon.astimezone(zone).date():
            if (day.weekday() + 1) % 7 in event["repeat_on"]:
                a = datetime.combine(day, local_start.timetz().replace(tzinfo=None), zone).astimezone(UTC)
                b = datetime.combine(day + (local_end.date() - local_start.date()),
                                     local_end.timetz().replace(tzinfo=None), zone).astimezone(UTC)
                if a >= start and a not in {parse(item) for item in event.get("exclude_starts", [])}:
                    output.append((a, b))
            day += timedelta(days=1)
    return output


def admitted(data, result):
    return tuple(sum(int((block.end - block.start) / MINUTE) for block in result.study_blocks
                     if block.task_id == task["id"]) for task in data["tasks"])


def verify(test, data, result):
    """Check the returned schedule by direct UTC intersections and minute sampling.

    Historical slots may already overlap or exceed today's cap. They cannot be
    rewritten by scheduling: assert that new work never adds to an overfull day.
    Planned reservations beyond remaining work saturate at remaining work.
    """
    now, zone = parse(data["current_time"]), ZoneInfo(data["timezone"])
    prefs = data["preferences"]
    tasks = {task["id"]: task for task in data["tasks"]}
    blocks = result.study_blocks
    ids = [block.id for block in blocks]
    test.assertEqual(len(ids), len(set(ids)))
    test.assertFalse(set(ids) & {block["id"] for block in data["locked_blocks"]})
    test.assertEqual(blocks, sorted(blocks, key=lambda block: (block.start, block.task_id, block.end)))
    pause = timedelta(minutes=prefs["break_minutes"])
    events = recurring_occurrences(data)
    wake, bed = time.fromisoformat(prefs["wake_up_time"]), time.fromisoformat(prefs["bedtime"])
    new_daily, old_daily = defaultdict(float), defaultdict(float)

    def count_days(start, end, counts):
        # Split elapsed UTC minutes by the local date, including partial minutes
        # at history boundaries. No wall-clock subtraction across DST.
        cursor = start
        while cursor < end:
            local = cursor.astimezone(zone)
            midnight = datetime.combine(local.date() + timedelta(days=1), time.min, zone).astimezone(UTC)
            stop = min(end, midnight)
            counts[local.date()] += (stop - cursor) / MINUTE
            cursor = stop

    for history in data["locked_blocks"]:
        if history["status"] != "skipped":
            count_days(parse(history["start"]), parse(history["end"]), old_daily)
    scheduled = defaultdict(int)
    for index, block in enumerate(blocks):
        test.assertIn(block.task_id, tasks)
        test.assertEqual(block.status, "planned")
        test.assertGreaterEqual(block.start, now)
        test.assertLessEqual(block.end, parse(tasks[block.task_id]["deadline"]))
        test.assertEqual(block.start.second + block.start.microsecond + block.end.second + block.end.microsecond, 0)
        length = (block.end - block.start) / MINUTE
        test.assertTrue(15 <= length <= prefs["max_session_minutes"], f"Invalid duration {length}")
        scheduled[block.task_id] += int(length)
        count_days(block.start, block.end, new_daily)
        for other in blocks[:index]:
            test.assertFalse(overlaps(block.start, block.end, other.start - pause, other.end + pause))
        for a, b in events:
            test.assertFalse(overlaps(block.start, block.end, a, b), f"Fixed event {a}..{b}")
        for history in data["locked_blocks"]:
            padding = pause if history["status"] != "skipped" else timedelta()
            test.assertFalse(overlaps(block.start, block.end, parse(history["start"]) - padding,
                                      parse(history["end"]) + padding), f"History {history}")
        cursor = block.start
        while cursor < block.end:
            clock = cursor.astimezone(zone).time()
            awake = wake <= clock < bed if wake < bed else clock >= wake or clock < bed
            test.assertTrue(awake, f"Asleep at {cursor.isoformat()} ({clock})")
            cursor += MINUTE
    for day, minutes in new_daily.items():
        test.assertLessEqual(minutes + old_daily[day], prefs["max_daily_study_minutes"] + 1e-8,
                             f"Daily capacity exceeded on {day}")
    shortages = {warning.task_id: warning.minutes for warning in result.unscheduled}
    test.assertEqual(len(shortages), len(result.unscheduled))
    for warning in result.unscheduled:
        test.assertIn(warning.task_id, tasks)
        test.assertGreater(warning.minutes, 0)
        test.assertTrue(warning.reason.strip())
    for task in tasks.values():
        reserved = sum(max(0, int((parse(history["end"]) - max(now, parse(history["start"]))) / MINUTE))
                       for history in data["locked_blocks"]
                       if history["task_id"] == task["id"] and history["status"] == "planned")
        test.assertEqual(scheduled[task["id"]] + min(task["remaining_minutes"], reserved) + shortages.get(task["id"], 0),
                         task["remaining_minutes"], f"Minute accounting for {task['id']}")


def generated(seed, count=24):
    rng = random.Random(seed)
    scenarios = (
        ("UTC", "2026-11-10T00:00:00Z"),
        ("America/Vancouver", "2026-03-08T08:00:00Z"),
        ("America/New_York", "2026-11-01T04:00:00Z"),
        ("Europe/Berlin", "2026-10-25T00:00:00Z"),
        ("Asia/Kathmandu", "2026-11-10T18:00:00Z"),
    )
    for index in range(count):
        zone_name, start = scenarios[index % len(scenarios)]
        zone = ZoneInfo(zone_name)
        base = parse(start)
        now = base + timedelta(minutes=rng.choice((0, 30, 95, 180, 720)), seconds=rng.choice((0, 0, 31)))
        stamp = lambda minutes: (base + timedelta(minutes=minutes)).isoformat()
        wake, bed = rng.choice((("00:00", "05:00"), ("08:00", "23:00"), ("20:00", "05:00")))
        tasks = [{"id": f"task-{task}", "title": f"Task {task}",
                  "estimated_minutes": rng.choice((15, 30, 90)),
                  "remaining_minutes": rng.choice((0, 8, 14, 15, 16, 31, 61, 105, 240)),
                  "deadline": stamp(rng.choice((120, 270, 780, 1500, 2880))),
                  "grade_weight": rng.choice((0, 1, 20, 50, 100))}
                 for task in range(rng.randint(1, 3))]
        events = []
        for event in range(rng.randint(2, 6)):
            a = rng.randrange(0, 2700)
            events.append({"id": f"event-{event}", "title": "Fixed", "start": stamp(a),
                           "end": stamp(a + rng.choice((7, 14, 30, 90, 180))), "repeat_on": []})
        # Recurrence straddles the DST date; explicit exception exercises omission.
        local = (base - timedelta(days=1)).astimezone(zone)
        a = datetime.combine(local.date(), time(9), zone).astimezone(UTC)
        excluded = datetime.combine(local.date() + timedelta(days=1), time(9), zone).astimezone(UTC)
        events.append({"id": "weekly", "title": "Class", "start": a.isoformat(),
                       "end": (a + timedelta(minutes=30)).isoformat(), "repeat_on": list(range(7)),
                       "exclude_starts": [excluded.isoformat()]})
        history = []
        for item, status in enumerate(("completed", "unfinished", "skipped", "planned", "planned")):
            offset = (-30, 60, 150, -10, 420)[item]
            a = now + timedelta(minutes=offset)
            history.append({"id": f"locked-{item}", "task_id": rng.choice(tasks)["id"],
                            "start": a.isoformat(), "end": (a + timedelta(minutes=rng.choice((10, 20, 45)))).isoformat(),
                            "status": status, "locked": True})
        yield {"contract_version": 1, "current_time": now.isoformat(), "timezone": zone_name,
               "tasks": tasks, "events": events, "locked_blocks": history,
               "preferences": {"wake_up_time": wake, "bedtime": bed,
                               "max_daily_study_minutes": rng.choice((15, 45, 90, 180, 300)),
                               "max_session_minutes": rng.choice((15, 16, 30, 60, 90)),
                               "break_minutes": rng.choice((0, 1, 5, 15, 30)), "spread_assignments": False}}


class GeneratedSchedulerTests(unittest.TestCase):
    def test_dst_elapsed_capacity_and_local_midnight_caps(self):
        for zone, start, end, work, cap, expected in (
            ("America/Vancouver", "2026-03-08T08:00:00Z", "2026-03-08T12:00:00Z", 300, 500, 240),
            ("America/New_York", "2026-11-01T04:00:00Z", "2026-11-01T10:00:00Z", 400, 500, 360),
            # 23:45 -> 01:00 in a non-hour offset zone; each local date gets
            # its own 30-minute cap, despite both dates being the same UTC day.
            ("Asia/Kathmandu", "2026-11-10T18:00:00Z", "2026-11-10T19:15:00Z", 60, 30, 45),
        ):
            data = next(generated(SEEDS[0], 1))
            data.update(timezone=zone, current_time=start, events=[], locked_blocks=[])
            data["tasks"] = [{"id": "boundary", "title": "Boundary", "estimated_minutes": work,
                              "remaining_minutes": work, "deadline": end, "grade_weight": 20}]
            data["preferences"].update(wake_up_time="00:00" if zone != "Asia/Kathmandu" else "20:00",
                                       bedtime="05:00", max_daily_study_minutes=cap,
                                       max_session_minutes=60, break_minutes=0)
            with self.subTest(timezone=zone, start=start):
                self.check_case(data)
                result = generate_schedule(ScheduleRequest.model_validate(data))
                self.assertEqual(admitted(data, result), (expected,))

    def test_fall_back_deadline_in_second_fold_after_current_time_in_first(self):
        data = next(generated(SEEDS[0], 1))
        data.update(timezone="America/New_York", current_time="2026-11-01T05:45:00Z", events=[], locked_blocks=[])
        data["tasks"] = [{"id": "fold", "title": "Repeated hour", "estimated_minutes": 30,
                          "remaining_minutes": 30, "deadline": "2026-11-01T06:30:00Z", "grade_weight": 20}]
        data["preferences"].update(wake_up_time="00:00", bedtime="03:00", max_daily_study_minutes=60,
                                   max_session_minutes=30, break_minutes=0)
        # 01:45 EDT -> 01:30 EST is 45 elapsed minutes, despite clock ordering.
        self.check_case(data)
        result = generate_schedule(ScheduleRequest.model_validate(data))
        self.assertEqual(admitted(data, result), (30,))

    def check_case(self, data):
        request = ScheduleRequest.model_validate(data)
        before = request.model_dump(mode="json")
        result = generate_schedule(request)
        verify(self, data, result)
        self.assertEqual(request.model_dump(mode="json"), before)
        self.assertEqual(generate_schedule(request), result)
        for ordering in permutations(data["tasks"]):
            reordered = {**data, "tasks": list(ordering)}
            self.assertEqual(generate_schedule(ScheduleRequest.model_validate(reordered)), result)
        spaced = copy.deepcopy(data)
        spaced["preferences"]["spread_assignments"] = True
        spread_result = generate_schedule(ScheduleRequest.model_validate(spaced))
        verify(self, spaced, spread_result)
        self.assertEqual(admitted(data, result), admitted(data, spread_result))
        spaced["tasks"].reverse()
        self.assertEqual(generate_schedule(ScheduleRequest.model_validate(spaced)), spread_result)

    def test_seeded_constraints_accounting_and_determinism(self):
        sessions = 0
        zones_with_sessions = set()
        for seed in SEEDS:
            for index, data in enumerate(generated(seed)):
                with self.subTest(seed=seed, case=index, request=json.dumps(data, sort_keys=True)):
                    self.check_case(data)
                    result = generate_schedule(ScheduleRequest.model_validate(data))
                    sessions += len(result.study_blocks)
                    if result.study_blocks:
                        zones_with_sessions.add(data["timezone"])
        # Avoid a vacuous pass if future fixture edits accidentally block all work.
        self.assertGreaterEqual(sessions, 40)
        self.assertEqual(zones_with_sessions, {"UTC", "America/Vancouver", "America/New_York",
                                              "Europe/Berlin", "Asia/Kathmandu"})


if __name__ == "__main__":
    unittest.main()
