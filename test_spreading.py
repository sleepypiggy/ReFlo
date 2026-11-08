"""Soft spacing must preserve each assignment's admitted work and constraints."""

import copy
import unittest
from collections import defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo

from backend.app.schedule_api import ScheduleRequest, generate_schedule
from test_schedule import request_payload


def totals(result):
    counts = defaultdict(int)
    for block in result.study_blocks:
        counts[block.task_id] += int((block.end - block.start).total_seconds() // 60)
    return dict(counts), {item.task_id: item.minutes for item in result.unscheduled}


class SpreadingTests(unittest.TestCase):
    def setUp(self):
        self.data = request_payload()
        self.data["preferences"].pop("spread_assignments")
        self.data["preferences"].update(bedtime="17:00", max_daily_study_minutes=240)
        self.data["tasks"][0]["deadline"] = "2026-11-13T17:00:00Z"

    def plan(self):
        before = copy.deepcopy(self.data)
        result = generate_schedule(ScheduleRequest.model_validate(self.data))
        self.assertEqual(self.data, before)
        packed_data = copy.deepcopy(self.data)
        packed_data["preferences"]["spread_assignments"] = False
        packed = generate_schedule(ScheduleRequest.model_validate(packed_data))
        self.assertEqual(totals(result), totals(packed))
        for left, right in zip(result.study_blocks, result.study_blocks[1:]):
            self.assertGreaterEqual(right.start - left.end, timedelta(minutes=self.data["preferences"]["break_minutes"]))
        for block in result.study_blocks:
            task = next(task for task in self.data["tasks"] if task["id"] == block.task_id)
            self.assertLessEqual(block.end.isoformat(), task["deadline"].replace("Z", "+00:00"))
            self.assertLessEqual(block.end - block.start, timedelta(minutes=self.data["preferences"]["max_session_minutes"]))
        return result

    def test_default_spreads_four_hours_over_four_days(self):
        result = self.plan()
        self.assertEqual([block.start.day for block in result.study_blocks], [10, 11, 12, 13])
        self.assertEqual([block.start.hour for block in result.study_blocks], [9, 12, 9, 12])
        self.assertEqual([int((block.end - block.start).total_seconds() // 60) for block in result.study_blocks], [60] * 4)
        self.assertEqual(result.unscheduled, [])

    def test_both_assignments_get_daily_sessions(self):
        self.data["tasks"].append({**self.data["tasks"][0], "id": "other", "title": "Other"})
        result = self.plan()
        by_task = defaultdict(set)
        for block in result.study_blocks:
            by_task[block.task_id].add(block.start.day)
        self.assertEqual(dict(by_task), {"statistics": {10, 11, 12, 13}, "other": {10, 11, 12, 13}})

    def test_spaces_same_day_sessions_when_there_is_room(self):
        self.data["tasks"][0].update(deadline="2026-11-10T17:00:00Z", remaining_minutes=180)
        result = self.plan()
        self.assertTrue(any(block.start.hour < 12 for block in result.study_blocks))
        self.assertTrue(any(block.start.hour >= 12 for block in result.study_blocks))
        for left, right in zip(result.study_blocks, result.study_blocks[1:]):
            self.assertGreaterEqual(right.start - left.end, timedelta(hours=1))

    def test_tight_deadline_keeps_minimum_breaks_and_all_work(self):
        self.data["tasks"][0].update(deadline="2026-11-10T12:00:00Z", remaining_minutes=150)
        result = self.plan()
        self.assertEqual(totals(result), ({"statistics": 150}, {}))
        self.assertEqual(result.study_blocks[1].start - result.study_blocks[0].end, timedelta(minutes=15))

    def test_busy_days_relax_assignment_shares(self):
        self.data["events"] = [{"id": "busy", "title": "Busy days", "start": "2026-11-11T00:00:00Z",
                                "end": "2026-11-13T00:00:00Z", "repeat_on": []}]
        result = self.plan()
        by_day = defaultdict(int)
        for block in result.study_blocks:
            by_day[block.start.day] += int((block.end - block.start).total_seconds() // 60)
        self.assertEqual(dict(by_day), {10: 120, 13: 120})

    def test_shortage_policy_is_unchanged(self):
        for task in self.data["tasks"]:
            task.update(deadline="2026-11-10T12:00:00Z", remaining_minutes=180)
        self.data["tasks"].append({**self.data["tasks"][0], "id": "other", "grade_weight": 80})
        self.data["preferences"]["max_daily_study_minutes"] = 120
        result = self.plan()
        self.assertEqual(totals(result), ({"other": 120}, {"statistics": 180, "other": 60}))

    def test_long_horizon_does_not_create_minute_long_sessions(self):
        self.data["tasks"][0].update(deadline="2026-12-01T17:00:00Z", remaining_minutes=60)
        result = self.plan()
        self.assertEqual(len(result.study_blocks), 2)
        self.assertTrue(all(block.end - block.start == timedelta(minutes=30) for block in result.study_blocks))

    def test_spacing_respects_local_days_across_dst(self):
        self.data.update(current_time="2026-10-31T08:00:00Z", timezone="America/New_York")
        self.data["tasks"][0].update(deadline="2026-11-02T22:00:00Z", remaining_minutes=180)
        result = self.plan()
        zone = ZoneInfo(self.data["timezone"])
        self.assertEqual([block.start.astimezone(zone).day for block in result.study_blocks], [31, 1, 2])
        self.assertEqual([block.start - block.start.astimezone(zone).replace(tzinfo=block.start.tzinfo)
                          for block in result.study_blocks], [timedelta(hours=4), timedelta(hours=5), timedelta(hours=5)])

    def test_identical_requests_keep_stable_ids(self):
        first = self.plan()
        self.assertEqual(first, self.plan())

    def test_can_turn_spacing_off(self):
        self.data["preferences"]["spread_assignments"] = False
        result = self.plan()
        self.assertEqual({block.start.day for block in result.study_blocks}, {10})

    def test_three_sessions_use_morning_afternoon_and_evening(self):
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-10T22:00:00Z", remaining_minutes=180)
        result = self.plan()
        self.assertEqual([block.start.hour for block in result.study_blocks], [9, 12, 17])

    def test_single_daily_sessions_vary_across_dayparts(self):
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-12T22:00:00Z", remaining_minutes=180)
        result = self.plan()
        self.assertEqual([(block.start.day, block.start.hour) for block in result.study_blocks], [(10, 9), (11, 12), (12, 17)])

    def test_different_assignments_share_dayparts(self):
        self.data["preferences"]["bedtime"] = "22:00"
        first = self.data["tasks"][0]
        first.update(deadline="2026-11-10T22:00:00Z", remaining_minutes=60)
        self.data["tasks"].extend([{**first, "id": "second"}, {**first, "id": "third"}])
        result = self.plan()
        self.assertEqual([block.start.hour for block in result.study_blocks], [9, 12, 17])

    def test_dayparts_move_around_fixed_conflicts(self):
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-10T22:00:00Z", remaining_minutes=180)
        self.data["events"] = [
            {"id": "lunch", "title": "Lunch", "start": "2026-11-10T12:00:00Z", "end": "2026-11-10T13:00:00Z", "repeat_on": []},
            {"id": "shift", "title": "Shift", "start": "2026-11-10T17:00:00Z", "end": "2026-11-10T18:00:00Z", "repeat_on": []},
        ]
        result = self.plan()
        self.assertEqual([block.start.hour for block in result.study_blocks], [9, 13, 18])

    def test_busy_morning_and_evening_still_schedule_all_work(self):
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-10T22:00:00Z", remaining_minutes=180)
        self.data["events"] = [
            {"id": "morning", "title": "Morning work", "start": "2026-11-10T09:00:00Z", "end": "2026-11-10T12:00:00Z", "repeat_on": []},
            {"id": "evening", "title": "Evening work", "start": "2026-11-10T17:00:00Z", "end": "2026-11-10T22:00:00Z", "repeat_on": []},
        ]
        result = self.plan()
        self.assertTrue(all(block.start.hour >= 12 and block.end.hour <= 17 for block in result.study_blocks))
        self.assertEqual(result.unscheduled, [])

    def test_daypart_preference_gives_way_to_a_morning_deadline(self):
        self.data["preferences"]["break_minutes"] = 0
        self.data["tasks"][0].update(deadline="2026-11-10T11:00:00Z", remaining_minutes=120)
        result = self.plan()
        self.assertEqual([block.start.hour for block in result.study_blocks], [9, 10])

    def test_dayparts_use_local_time_even_when_utc_date_changes(self):
        self.data.update(timezone="America/Vancouver", current_time="2026-11-10T15:00:00Z")
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-11T05:00:00Z", remaining_minutes=180)
        result = self.plan()
        local = [block.start.astimezone(ZoneInfo("America/Vancouver")) for block in result.study_blocks]
        self.assertEqual([(value.day, value.hour) for value in local], [(10, 9), (10, 12), (10, 17)])

    def test_locked_history_stays_reserved_with_daypart_spacing(self):
        self.data["preferences"]["bedtime"] = "22:00"
        self.data["tasks"][0].update(deadline="2026-11-10T22:00:00Z", remaining_minutes=180)
        self.data["locked_blocks"] = [{"id": "history", "task_id": "statistics", "start": "2026-11-10T09:00:00Z",
                                       "end": "2026-11-10T10:00:00Z", "status": "unfinished", "locked": True}]
        result = self.plan()
        self.assertEqual(sum(int((block.end - block.start).total_seconds() // 60) for block in result.study_blocks), 180)
        self.assertTrue(all(block.start.hour >= 10 for block in result.study_blocks))
        self.assertNotIn("history", {block.id for block in result.study_blocks})


if __name__ == "__main__":
    unittest.main()
