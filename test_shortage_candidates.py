"""Counterfactual limits exercise the real, unchanged scheduling policy."""
import copy
import unittest
from datetime import timedelta

from fastapi.testclient import TestClient
from backend.app.main import app
from test_schedule import request_payload, dt, minutes


class ShortageCandidateTests(unittest.TestCase):
    def test_higher_limits_fit_more_without_relaxing_other_constraints(self):
        payload = request_payload()
        payload["tasks"][0].update(remaining_minutes=300, estimated_minutes=300,
            deadline="2026-11-11T14:00:00Z")
        payload["preferences"].update(bedtime="14:00", max_daily_study_minutes=120)
        payload["events"] = [{"id": "class", "title": "Class", "start": "2026-11-10T11:00:00Z",
                              "end": "2026-11-10T12:00:00Z", "repeat_on": [2, 3]}]
        payload["locked_blocks"] = [{"id": "protected", "task_id": "statistics",
            "start": "2026-11-10T09:00:00Z", "end": "2026-11-10T09:30:00Z",
            "status": "unfinished", "locked": True}]
        original = copy.deepcopy(payload)
        shortages = []
        with TestClient(app) as client:
            for limit in (120, 150, 180, 240):
                candidate = copy.deepcopy(payload)
                candidate["preferences"]["max_daily_study_minutes"] = limit
                response = client.post("/schedule", json=candidate)
                self.assertEqual(response.status_code, 200, response.text)
                plan = response.json()
                missing = sum(item["minutes"] for item in plan["unscheduled"])
                shortages.append(missing)
                self.assertEqual(minutes(plan["study_blocks"]) + missing, 300)
                daily = {"2026-11-10": 30}  # Protected study counts toward daily limits.
                blocks = plan["study_blocks"]
                for block in blocks:
                    start, end = dt(block["start"]), dt(block["end"])
                    self.assertGreaterEqual(start.hour, 9)
                    self.assertLessEqual(end.hour, 14)
                    self.assertLessEqual(end, dt(candidate["tasks"][0]["deadline"]))
                    self.assertGreaterEqual(minutes([block]), 15)
                    self.assertLessEqual(minutes([block]), 60)
                    self.assertNotEqual(block["id"], "protected")
                    self.assertFalse(start.hour < 12 and end.hour > 11)  # Recurring class.
                    if start.day == 10:
                        self.assertGreaterEqual(start, dt("2026-11-10T09:45:00Z"))
                    day = start.date().isoformat()
                    daily[day] = daily.get(day, 0) + minutes([block])
                self.assertTrue(all(value <= limit for value in daily.values()))
                for left, right in zip(blocks, blocks[1:]):
                    self.assertGreaterEqual(dt(right["start"]) - dt(left["end"]), timedelta(minutes=15))
        self.assertGreater(shortages[0], shortages[1])
        self.assertGreater(shortages[1], shortages[2])
        self.assertEqual(shortages[2], 0)
        self.assertEqual(payload, original)

    def test_increases_cannot_resolve_work_below_minimum_session(self):
        payload = request_payload()
        payload["tasks"][0].update(remaining_minutes=8, estimated_minutes=8)
        with TestClient(app) as client:
            for limit in (120, 150, 180, 240):
                payload["preferences"]["max_daily_study_minutes"] = limit
                plan = client.post("/schedule", json=payload).json()
                self.assertEqual(plan["study_blocks"], [])
                self.assertEqual(plan["unscheduled"][0]["minutes"], 8)


if __name__ == "__main__":
    unittest.main()
