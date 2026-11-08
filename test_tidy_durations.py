"""Five-minute session preferences must preserve feasible, exact work totals."""

import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.schedule_api import ScheduleRequest, _tidy_durations, event_windows, generate_schedule
from test_schedule import dt, request_payload


class TidyDurationTests(unittest.TestCase):
    def setUp(self):
        self.payload = request_payload()
        self.payload["preferences"].update(max_session_minutes=120)
        self.blocks = [
            ("statistics", dt("2026-11-10T09:00:00Z"), dt("2026-11-10T09:36:00Z")),
            ("statistics", dt("2026-11-11T09:00:00Z"), dt("2026-11-11T09:54:00Z")),
        ]

    def tidy(self):
        request = ScheduleRequest.model_validate(self.payload)
        return _tidy_durations(request, self.blocks, {
            "fixed": event_windows(request, max(task.deadline for task in request.tasks)),
        })

    def durations(self, blocks):
        return [int((end - start) / timedelta(minutes=1)) for _, start, end in blocks]

    def test_36_and_54_become_35_and_55(self):
        result = self.tidy()
        self.assertEqual(self.durations(result), [35, 55])
        self.assertEqual([block[1] for block in result], [block[1] for block in self.blocks])
        self.assertEqual(self.durations(self.blocks), [36, 54])
        self.assertEqual(self.tidy(), result)

    def test_odd_total_remains_exact(self):
        self.blocks[1] = (*self.blocks[1][:2], dt("2026-11-11T09:53:00Z"))
        self.assertEqual(self.durations(self.tidy()), [35, 54])

    def test_fixed_event_prevents_extension(self):
        self.payload["events"] = [
            {"id": str(index), "title": "Class", "start": block[2].isoformat(),
             "end": (block[2] + timedelta(hours=1)).isoformat()}
            for index, block in enumerate(self.blocks)
        ]
        self.assertEqual(self.tidy(), self.blocks)

    def test_deadline_prevents_extension(self):
        self.payload["tasks"][0]["deadline"] = "2026-11-11T09:54:00Z"
        self.assertEqual(self.durations(self.tidy()), [40, 50])

    def test_daily_limit_prevents_extension(self):
        self.payload["preferences"]["max_daily_study_minutes"] = 54
        self.assertEqual(self.durations(self.tidy()), [40, 50])

    def test_sleep_prevents_extension(self):
        self.payload["preferences"]["bedtime"] = "09:54"
        self.assertEqual(self.durations(self.tidy()), [40, 50])

    def test_break_before_locked_history_prevents_extension(self):
        self.payload["locked_blocks"] = [{
            "id": "history", "task_id": "statistics", "start": "2026-11-11T10:09:00Z",
            "end": "2026-11-11T10:24:00Z", "status": "completed", "locked": True,
        }]
        self.assertEqual(self.durations(self.tidy()), [40, 50])

    def test_minimum_and_maximum_session_lengths(self):
        for limit in (16, 36):
            with self.subTest(limit=limit):
                self.payload["preferences"]["max_session_minutes"] = limit
                self.blocks = [(task, start, start + timedelta(minutes=limit))
                               for task, start, _ in self.blocks]
                self.assertEqual(self.tidy(), self.blocks)

    def test_schedule_endpoint_prefers_round_durations(self):
        self.payload["tasks"][0]["remaining_minutes"] = 90
        self.payload["events"] = [{
            "id": "busy", "title": "Busy", "start": "2026-11-10T09:36:00Z",
            "end": "2026-11-11T09:00:00Z",
        }]
        with TestClient(app) as client:
            response = client.post("/schedule", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        durations = [int((dt(block["end"]) - dt(block["start"])) / timedelta(minutes=1))
                     for block in data["study_blocks"]]
        self.assertEqual(durations, [35, 55])
        self.assertEqual(data["unscheduled"], [])

    def test_cannot_transfer_work_between_assignments(self):
        self.payload["tasks"].append({**self.payload["tasks"][0], "id": "other"})
        self.blocks[1] = ("other", *self.blocks[1][1:])
        self.assertEqual(self.tidy(), self.blocks)

    def test_73_minutes_preserves_exact_work_and_minimum_session(self):
        self.payload["tasks"][0].update(estimated_minutes=73, remaining_minutes=73)
        self.payload["preferences"]["max_session_minutes"] = 60
        result = generate_schedule(ScheduleRequest.model_validate(self.payload))
        lengths = [int((block.end - block.start) / timedelta(minutes=1))
                   for block in result.study_blocks]
        self.assertEqual(lengths, [58, 15])
        self.assertFalse(result.unscheduled)

    def test_rounding_preserves_admitted_work_for_every_estimate_through_180(self):
        # Compare to the same scheduling pipeline with the new preference disabled.
        for estimate in range(181):
            for maximum in (15, 16, 60):
                for spread in (False, True):
                    with self.subTest(estimate=estimate, maximum=maximum, spread=spread):
                        self.payload["tasks"][0].update(
                            estimated_minutes=estimate, remaining_minutes=estimate)
                        self.payload["preferences"].update(
                            max_session_minutes=maximum, spread_assignments=spread)
                        request = ScheduleRequest.model_validate(self.payload)
                        with patch("backend.app.schedule_api._tidy_durations",
                                   side_effect=lambda request, blocks, availability: blocks):
                            before = generate_schedule(request)
                        after = generate_schedule(request)
                        lengths = [int((block.end - block.start) / timedelta(minutes=1))
                                   for block in after.study_blocks]
                        self.assertTrue(all(15 <= length <= maximum for length in lengths))
                        self.assertEqual(sum(lengths), sum(
                            int((block.end - block.start) / timedelta(minutes=1))
                            for block in before.study_blocks))
                        self.assertEqual(after.unscheduled, before.unscheduled)
                        self.assertEqual(sum(lengths) + sum(warning.minutes for warning in after.unscheduled),
                                         estimate)


if __name__ == "__main__":
    unittest.main()
