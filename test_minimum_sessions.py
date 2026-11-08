"""Dashboard sessions have useful lengths without rounding up assignment work."""

import unittest
from datetime import timedelta

from backend.app.schedule_api import ScheduleRequest, generate_schedule
from test_schedule import request_payload


class MinimumSessionTests(unittest.TestCase):
    def plan(self, minutes, *, spread=False, maximum=60, events=None, deadline=None):
        data = request_payload()
        data["preferences"].update(bedtime="22:00", max_daily_study_minutes=480,
                                   spread_assignments=spread, max_session_minutes=maximum)
        data["tasks"][0].update(remaining_minutes=minutes, deadline=deadline or "2026-11-10T22:00:00Z")
        data["events"] = events or []
        result = generate_schedule(ScheduleRequest.model_validate(data))
        lengths = [int((block.end - block.start) / timedelta(minutes=1)) for block in result.study_blocks]
        self.assertTrue(all(15 <= length <= maximum for length in lengths))
        self.assertEqual(sum(lengths) + sum(item.minutes for item in result.unscheduled), minutes)
        return lengths, result

    def test_uneven_last_session_is_allowed(self):
        lengths, result = self.plan(105)
        self.assertEqual(lengths, [60, 45])
        self.assertFalse(result.unscheduled)

    def test_small_tail_is_redistributed(self):
        for minutes in (61, 68, 74, 121, 128):
            for spread in (False, True):
                with self.subTest(minutes=minutes, spread=spread):
                    _, result = self.plan(minutes, spread=spread)
                    self.assertFalse(result.unscheduled)

    def test_tiny_free_gaps_are_skipped(self):
        events = [{"id": "busy", "title": "Class", "start": "2026-11-10T09:08:00Z",
                   "end": "2026-11-10T10:00:00Z", "repeat_on": []}]
        lengths, result = self.plan(60, events=events)
        self.assertEqual(lengths, [60])
        self.assertEqual(result.study_blocks[0].start.hour, 10)

    def test_daily_balancing_keeps_minimum(self):
        for minutes in (61, 68, 74, 105, 128):
            _, result = self.plan(minutes, spread=True, deadline="2026-11-13T22:00:00Z")
            self.assertFalse(result.unscheduled)

    def test_less_than_minimum_is_unscheduled_without_overbooking(self):
        for minutes in (8, 14):
            lengths, result = self.plan(minutes)
            self.assertEqual(lengths, [])
            self.assertEqual(result.unscheduled[0].minutes, minutes)

    def test_small_preferred_maximum_does_not_create_tiny_blocks(self):
        lengths, result = self.plan(60, maximum=10)
        self.assertEqual(lengths, [])
        self.assertEqual(result.unscheduled[0].minutes, 60)

    def test_shortage_can_admit_a_valid_partial_session(self):
        lengths, result = self.plan(60, deadline="2026-11-10T09:20:00Z")
        self.assertEqual(lengths, [20])
        self.assertEqual(result.unscheduled[0].minutes, 40)

    def test_tiny_deadline_window_is_not_used(self):
        lengths, result = self.plan(60, deadline="2026-11-10T09:14:00Z")
        self.assertEqual(lengths, [])
        self.assertEqual(result.unscheduled[0].minutes, 60)
