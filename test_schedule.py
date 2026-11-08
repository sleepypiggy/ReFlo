"""Dashboard contract tests against the real scheduling implementation."""

import copy
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from backend.app.main import app


def request_payload():
    return {
        "contract_version": 1, "current_time": "2026-11-10T08:00:00.123Z", "timezone": "UTC",
        "tasks": [{"id": "statistics", "title": "Statistics", "deadline": "2026-11-12T12:00:00.000Z",
                   "estimated_minutes": 240, "remaining_minutes": 240, "grade_weight": 20}],
        "events": [],
        "preferences": {"wake_up_time": "09:00", "bedtime": "12:00", "max_daily_study_minutes": 120,
                        "max_session_minutes": 60, "break_minutes": 15, "spread_assignments": False},
        "locked_blocks": [],
    }


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def minutes(blocks):
    return sum(int((dt(block["end"]) - dt(block["start"])).total_seconds() // 60) for block in blocks)


class DashboardApiTests(unittest.TestCase):
    def test_moved_weekly_occurrence_excludes_original_and_reserves_replacement(self):
        self.payload["tasks"][0]["remaining_minutes"] = 60
        self.payload["events"] = [
            {"id": "series", "title": "Class", "start": "2026-11-10T09:00:00Z",
             "end": "2026-11-10T10:00:00Z", "repeat_on": [2, 3],
             "exclude_starts": ["2026-11-10T09:00:00Z"]},
            {"id": "moved", "title": "Class", "start": "2026-11-10T10:00:00Z",
             "end": "2026-11-10T12:00:00Z", "repeat_on": []},
        ]
        data = self.plan()
        self.assertEqual(data["study_blocks"][0]["start"], "2026-11-10T09:00:00Z")
        self.assertEqual(minutes(data["study_blocks"]), 60)

    def test_manual_planned_reservation_reduces_demand_without_completing_work(self):
        self.payload["locked_blocks"] = [{"id": "manual", "task_id": "statistics",
            "start": "2026-11-10T10:00:00Z", "end": "2026-11-10T11:00:00Z",
            "status": "planned", "locked": True}]
        data = self.plan()
        self.assertEqual(minutes(data["study_blocks"]) + 60 + sum(item["minutes"] for item in data["unscheduled"]), 240)
        for block in data["study_blocks"]:
            self.assertFalse(dt(block["start"]) < dt("2026-11-10T11:15:00Z") and
                             dt(block["end"]) > dt("2026-11-10T09:45:00Z"))

    def test_imported_occurrences_reserve_exact_utc_instants(self):
        # Calendar imports expand weekly rules and exceptions before /schedule.
        # A moved class keeps its occurrence ID but sends the replacement time.
        self.payload["events"] = [
            {"id": "ics-original-occurrence", "title": "Imported class", "start": "2026-11-10T09:00:00Z",
             "end": "2026-11-10T10:30:00Z", "repeat_on": []},
            {"id": "ics-moved-occurrence", "title": "Moved class", "start": "2026-11-11T10:00:00Z",
             "end": "2026-11-11T11:00:00Z", "repeat_on": []},
        ]
        data = self.plan()
        self.assertTrue(data["study_blocks"])
        for block in data["study_blocks"]:
            for event in self.payload["events"]:
                self.assertFalse(dt(block["start"]) < dt(event["end"]) and dt(block["end"]) > dt(event["start"]))

    def setUp(self):
        self.client = TestClient(app)
        self.payload = request_payload()

    def tearDown(self):
        self.client.close()

    def plan(self):
        response = self.client.post("/schedule", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        ids = [item["id"] for item in data["study_blocks"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertFalse(set(ids) & {item["id"] for item in self.payload["locked_blocks"]})
        for block in data["study_blocks"]:
            self.assertGreaterEqual(dt(block["start"]), dt(self.payload["current_time"]))
            self.assertEqual(block["status"], "planned")
            self.assertTrue(block["start"].endswith("Z"))
            task = next(item for item in self.payload["tasks"] if item["id"] == block["task_id"])
            self.assertLessEqual(dt(block["end"]), dt(task["deadline"]))
        for left, right in zip(data["study_blocks"], data["study_blocks"][1:]):
            self.assertGreaterEqual(dt(right["start"]) - dt(left["end"]),
                                    timedelta(minutes=self.payload["preferences"]["break_minutes"]))
        return data

    def test_three_scenarios(self):
        initial = self.plan()
        self.assertEqual(len(initial["study_blocks"]), 4)
        self.assertEqual(minutes(initial["study_blocks"]), 240)
        self.assertEqual(initial["unscheduled"], [])
        self.assertEqual([dt(item["start"]).weekday() for item in initial["study_blocks"]], [1, 1, 2, 2])
        self.payload["current_time"] = "2026-11-10T20:00:00.000Z"
        self.payload["tasks"][0]["remaining_minutes"] = 180
        self.payload["locked_blocks"] = [{**item, "locked": True} for item in initial["study_blocks"][:2]]
        replanned = self.plan()
        self.assertEqual(minutes(replanned["study_blocks"]), 180)
        self.assertEqual(replanned["unscheduled"], [])
        self.payload["events"] = [{"id": "shift", "title": "Work shift", "start": "2026-11-12T09:00:00Z",
                                   "end": "2026-11-12T12:00:00Z", "repeat_on": []}]
        revised = self.plan()
        self.assertEqual(minutes(revised["study_blocks"]), 120)
        self.assertEqual(revised["unscheduled"][0]["minutes"], 60)

    def test_assignments_share_windows_and_daily_cap(self):
        self.payload["tasks"].append({**self.payload["tasks"][0], "id": "other", "title": "Other"})
        data = self.plan()
        totals = {}
        for block in data["study_blocks"]:
            day = block["start"][:10]
            totals[day] = totals.get(day, 0) + minutes([block])
        self.assertTrue(all(total <= 120 for total in totals.values()))
        for task in self.payload["tasks"]:
            planned = minutes([block for block in data["study_blocks"] if block["task_id"] == task["id"]])
            missing = sum(item["minutes"] for item in data["unscheduled"] if item["task_id"] == task["id"])
            self.assertEqual(planned + missing, task["remaining_minutes"])

    def test_repeated_generation_replaces_future_work(self):
        first, second = self.plan(), self.plan()
        self.assertEqual([(block["start"], block["end"]) for block in first["study_blocks"]],
                         [(block["start"], block["end"]) for block in second["study_blocks"]])

    def test_locked_history_reserves_time_without_double_credit(self):
        self.payload["locked_blocks"] = [{"id": "history", "task_id": "statistics", "start": "2026-11-10T09:00:00Z",
                                           "end": "2026-11-10T10:00:00Z", "status": "unfinished", "locked": True}]
        data = self.plan()
        self.assertEqual(minutes(data["study_blocks"]), 240)
        self.assertTrue(all(dt(block["start"]) >= dt("2026-11-10T10:15:00Z") for block in data["study_blocks"]))

    def test_assistant_work_shift_preview(self):
        """Preview a hand-written shift without crediting unfinished history."""
        zone = ZoneInfo("America/Vancouver")

        def local(hour, minute=0):
            return datetime(2026, 11, 10, hour, minute, tzinfo=zone)

        self.payload.update(
            current_time=local(18).isoformat(), timezone="America/Vancouver",
        )
        self.payload["tasks"][0].update(remaining_minutes=30)
        self.payload["preferences"].update(
            wake_up_time="09:00", bedtime="22:00", break_minutes=15,
        )
        unfinished = {
            "id": "unfinished-statistics", "task_id": "statistics",
            "start": local(17, 46).isoformat(), "end": local(18, 46).isoformat(),
            "status": "unfinished", "locked": True,
        }
        self.payload["locked_blocks"] = [copy.deepcopy(unfinished)]
        # Deliberately hand-written event draft: no assistant/model call needed.
        shift_draft = {
            "id": "work-shift-preview", "title": "Work shift",
            "start": local(19).isoformat(), "end": local(20).isoformat(),
            "repeat_on": [],
        }
        cases = (
            ("no shift", [], local(21), local(19, 1), local(19, 31), 0),
            ("shift fits", [shift_draft], local(21), local(20), local(20, 30), 0),
            ("shift leaves shortage", [shift_draft], local(20, 15), local(20), local(20, 15), 15),
        )
        for name, events, deadline, start, end, missing in cases:
            with self.subTest(case=name):
                self.payload["events"] = copy.deepcopy(events)
                self.payload["tasks"][0]["deadline"] = deadline.isoformat()
                data = self.plan()
                self.assertEqual(len(data["study_blocks"]), 1)
                block = data["study_blocks"][0]
                self.assertEqual(block["task_id"], "statistics")
                self.assertEqual(dt(block["start"]).astimezone(zone), start)
                self.assertEqual(dt(block["end"]).astimezone(zone), end)
                self.assertEqual(minutes(data["study_blocks"]), 30 - missing)
                if missing:
                    self.assertEqual(len(data["unscheduled"]), 1)
                    self.assertEqual(data["unscheduled"][0]["task_id"], "statistics")
                    self.assertEqual(data["unscheduled"][0]["minutes"], missing)
                else:
                    self.assertEqual(data["unscheduled"], [])
                self.assertEqual(self.payload["locked_blocks"], [unfinished])
                self.assertGreaterEqual(dt(block["start"]) - dt(unfinished["end"]),
                                        timedelta(minutes=15))
                for event in events:
                    self.assertTrue(dt(block["end"]) <= dt(event["start"])
                                    or dt(block["start"]) >= dt(event["end"]))

    def test_future_planned_locked_session_reserves_remaining_work(self):
        self.payload["locked_blocks"] = [{"id": "reserved", "task_id": "statistics", "start": "2026-11-10T09:00:00Z",
                                           "end": "2026-11-10T10:00:00Z", "status": "planned", "locked": True}]
        data = self.plan()
        self.assertEqual(minutes(data["study_blocks"]), 180)

    def test_recurring_overnight_commitment(self):
        self.payload["events"] = [{"id": "night", "title": "Night shift", "start": "2026-11-09T22:00:00Z",
                                   "end": "2026-11-10T10:00:00Z", "repeat_on": [1, 2, 3]}]
        data = self.plan()
        self.assertTrue(all(dt(block["start"]).hour >= 10 for block in data["study_blocks"]))
        self.assertEqual(minutes(data["study_blocks"]), 240)

    def test_overnight_waking_hours(self):
        self.payload["preferences"].update(wake_up_time="20:00", bedtime="03:00")
        data = self.plan()
        self.assertTrue(data["study_blocks"])
        self.assertTrue(all(dt(block["start"]).hour >= 20 for block in data["study_blocks"]))

    def test_wake_up_minimum_and_local_six_am_boundary(self):
        self.payload["preferences"]["wake_up_time"] = "05:59"
        response = self.client.post("/schedule", json=self.payload)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("06:00", response.text)
        self.payload.update(timezone="America/Vancouver", current_time="2026-11-10T13:00:00Z")
        self.payload["tasks"][0].update(deadline="2026-11-10T16:00:00Z", remaining_minutes=60)
        self.payload["preferences"].update(wake_up_time="06:00", bedtime="23:00")
        for spread in (False, True):
            self.payload["preferences"]["spread_assignments"] = spread
            blocks = self.plan()["study_blocks"]
            self.assertTrue(blocks)
            self.assertGreaterEqual(dt(blocks[0]["start"]).astimezone(ZoneInfo("America/Vancouver")).hour, 6)

    def test_real_browser_seconds_round_forward(self):
        self.payload["current_time"] = "2026-11-10T09:00:30.123Z"
        data = self.plan()
        self.assertEqual(data["study_blocks"][0]["start"], "2026-11-10T09:01:00Z")

    def test_past_deadline_and_zero_work(self):
        self.payload["tasks"][0]["deadline"] = "2026-11-09T00:00:00Z"
        data = self.plan()
        self.assertEqual(data["study_blocks"], [])
        self.assertEqual(data["unscheduled"][0]["minutes"], 240)
        self.payload["tasks"][0]["remaining_minutes"] = 0
        self.assertEqual(self.plan(), {"study_blocks": [], "unscheduled": []})

    def test_dst_recurrence_uses_local_clock(self):
        self.payload.update(timezone="America/New_York", current_time="2026-10-31T08:00:00Z")
        self.payload["tasks"][0].update(deadline="2026-11-02T23:00:00Z", remaining_minutes=600)
        self.payload["events"] = [{"id": "class", "title": "Class", "start": "2026-10-31T13:00:00Z",
                                   "end": "2026-10-31T14:00:00Z", "repeat_on": [0, 1, 6]}]
        data = self.plan()
        self.assertEqual(data["study_blocks"][0]["start"], "2026-10-31T14:00:00Z")
        self.assertTrue(any(block["start"] == "2026-11-01T15:00:00Z" for block in data["study_blocks"]))

    def test_validation_and_cors(self):
        invalid = []
        for key, value in (("timezone", "Mars/Olympus"), ("current_time", "2026-11-10T09:00:00")):
            invalid.append({**self.payload, key: value})
        invalid.append({**self.payload, "tasks": [self.payload["tasks"][0]] * 2})
        invalid.append({**self.payload, "locked_blocks": [{"id": "bad", "task_id": "missing", "start": "2026-11-10T09:00:00Z",
                                                          "end": "2026-11-10T10:00:00Z", "status": "planned", "locked": True}]})
        bad = copy.deepcopy(self.payload)
        bad["tasks"][0]["remaining_minutes"] = True
        invalid.append(bad)
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.client.post("/schedule", json=payload, headers={"Origin": "http://localhost:3000"})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")

    def test_urgent_low_weight_task_is_not_starved_by_later_deadline(self):
        self.payload["tasks"][0].update(grade_weight=90, remaining_minutes=120)
        self.payload["tasks"].append({**self.payload["tasks"][0], "id": "urgent", "grade_weight": 5,
                                      "deadline": "2026-11-10T12:00:00Z", "remaining_minutes": 120})
        data = self.plan()
        self.assertEqual(data["study_blocks"][0]["task_id"], "urgent")
        self.assertEqual(data["unscheduled"], [])

    def test_skipped_session_preserves_remaining_work(self):
        self.payload["locked_blocks"] = [{"id": "skip", "task_id": "statistics", "start": "2026-11-10T09:00:00Z",
                                           "end": "2026-11-10T10:00:00Z", "status": "skipped", "locked": True}]
        data = self.plan()
        self.assertEqual(minutes(data["study_blocks"]), 240)
        self.assertEqual(data["unscheduled"], [])

    def test_skipped_time_does_not_use_daily_study_budget(self):
        self.payload["preferences"].update(bedtime="14:00")
        self.payload["tasks"][0].update(remaining_minutes=120, deadline="2026-11-10T14:00:00Z")
        self.payload["locked_blocks"] = [{"id": "skip", "task_id": "statistics", "start": "2026-11-10T09:00:00Z",
                                           "end": "2026-11-10T10:00:00Z", "status": "skipped", "locked": True}]
        data = self.plan()
        self.assertEqual(minutes(data["study_blocks"]), 120)
        self.assertEqual(data["study_blocks"][0]["start"], "2026-11-10T10:00:00Z")
        self.assertEqual(data["unscheduled"], [])


if __name__ == "__main__":
    unittest.main()
