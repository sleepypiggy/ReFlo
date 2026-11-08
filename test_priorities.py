"""Exercise Phase 4 against the active scheduler without an HTTP test client."""
import copy
import unittest

from backend.app.schedule_api import ScheduleRequest, generate_schedule


def payload():
    return {
        "contract_version": 1, "current_time": "2026-11-13T08:00:00Z", "timezone": "UTC",
        "tasks": [
            {"id": "essay", "title": "Essay", "deadline": "2026-11-13T13:00:00Z",
             "estimated_minutes": 180, "remaining_minutes": 180, "grade_weight": 40},
            {"id": "math", "title": "Math", "deadline": "2026-11-13T14:00:00Z",
             "estimated_minutes": 180, "remaining_minutes": 180, "grade_weight": 10},
        ],
        "events": [], "locked_blocks": [],
        "preferences": {"wake_up_time": "09:00", "bedtime": "14:00",
                        "max_daily_study_minutes": 240, "max_session_minutes": 60, "break_minutes": 0},
    }


def totals(result):
    planned = {}
    for block in result.study_blocks:
        planned[block.task_id] = planned.get(block.task_id, 0) + int((block.end - block.start).total_seconds() / 60)
    return planned, {item.task_id: item.minutes for item in result.unscheduled}


class PriorityTests(unittest.TestCase):
    def test_six_hours_due_four_fit(self):
        planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(payload())))
        self.assertEqual(planned, {"essay": 180, "math": 60})
        self.assertEqual(missing, {"math": 120})

    def test_higher_weight_overrides_earlier_deadline_and_input_order(self):
        data = payload()
        data["tasks"][1]["grade_weight"] = 80
        before = copy.deepcopy(data)
        planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(data)))
        self.assertEqual(planned, {"math": 180, "essay": 60})
        self.assertEqual(missing, {"essay": 120})
        self.assertEqual(data, before)
        for task in data["tasks"]:
            self.assertEqual(planned.get(task["id"], 0) + missing.get(task["id"], 0), task["remaining_minutes"])
        data["tasks"].reverse()
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))), (planned, missing))

    def test_equal_weights_prioritize_closest_deadline_over_input_order_and_id(self):
        data = payload()
        data["tasks"][1]["grade_weight"] = 40
        data["tasks"][0]["id"] = "z-earlier"
        data["tasks"][1]["id"] = "a-later"
        data["tasks"].reverse()
        planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(data)))
        self.assertEqual(planned, {"z-earlier": 180, "a-later": 60})
        self.assertEqual(missing, {"a-later": 120})

    def test_equal_weights_and_deadlines_use_stable_id_tie_break(self):
        data = payload()
        data["tasks"][1].update(grade_weight=40, deadline=data["tasks"][0]["deadline"])
        first = totals(generate_schedule(ScheduleRequest.model_validate(data)))
        data["tasks"].reverse()
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))), first)
        self.assertEqual(first, ({"essay": 180, "math": 60}, {"math": 120}))

    def test_zero_weight_is_valid_and_loses_to_positive_weight(self):
        data = payload()
        data["tasks"][0]["grade_weight"] = 0
        data["tasks"][1]["grade_weight"] = 1
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))),
                         ({"math": 180, "essay": 60}, {"essay": 120}))

    def test_higher_weight_is_scheduled_first_even_when_all_work_fits(self):
        data = payload()
        data["preferences"].update(bedtime="18:00", max_daily_study_minutes=600)
        data["tasks"][0]["deadline"] = "2026-11-13T16:00:00Z"
        data["tasks"][1].update(grade_weight=80, deadline="2026-11-13T18:00:00Z")
        result = generate_schedule(ScheduleRequest.model_validate(data))
        self.assertEqual([block.task_id for block in result.study_blocks], ["math"] * 3 + ["essay"] * 3)
        self.assertEqual(totals(result), ({"math": 180, "essay": 180}, {}))

    def test_locked_history_and_fixed_commitment_stay_reserved(self):
        data = payload()
        data["tasks"][1]["grade_weight"] = 80
        data["locked_blocks"] = [{"id": "past", "task_id": "essay",
                                  "start": "2026-11-13T07:00:00Z", "end": "2026-11-13T08:00:00Z",
                                  "status": "unfinished", "locked": True}]
        data["events"] = [{"id": "lecture", "title": "Lecture", "start": "2026-11-13T10:00:00Z",
                           "end": "2026-11-13T11:00:00Z", "repeat_on": []}]
        request = ScheduleRequest.model_validate(data)
        result = generate_schedule(request)
        for block in result.study_blocks:
            self.assertGreaterEqual(block.start, request.current_time)
            self.assertTrue(block.end <= request.events[0].start or block.start >= request.events[0].end)
            self.assertNotEqual(block.id, "past")
        planned, missing = totals(result)
        self.assertEqual(sum(planned.values()), 180)
        self.assertEqual(sum(missing.values()), 180)

    def test_zero_capacity_and_completed_work(self):
        data = payload()
        data["tasks"][0]["remaining_minutes"] = 0
        data["events"] = [{"id": "busy", "title": "Busy", "start": "2026-11-13T09:00:00Z",
                           "end": "2026-11-13T14:00:00Z", "repeat_on": []}]
        planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(data)))
        self.assertEqual(planned, {})
        self.assertEqual(missing, {"math": 180})


if __name__ == "__main__":
    unittest.main()
