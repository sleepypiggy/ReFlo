"""Deadline feasibility, shortage policy, and accounting regressions."""
import copy
import unittest
from datetime import timedelta
from itertools import product

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
                        "max_daily_study_minutes": 240, "max_session_minutes": 60, "break_minutes": 0, "spread_assignments": False},
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

    def test_equal_scores_prioritize_closest_deadline_over_input_order_and_id(self):
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

    def test_earlier_deadline_reserves_slots_even_when_later_weight_is_higher(self):
        data = payload()
        data["preferences"].update(bedtime="18:00", max_daily_study_minutes=600)
        data["tasks"][0]["deadline"] = "2026-11-13T12:00:00Z"
        data["tasks"][1].update(grade_weight=80, deadline="2026-11-13T18:00:00Z")
        result = generate_schedule(ScheduleRequest.model_validate(data))
        self.assertEqual([block.task_id for block in result.study_blocks], ["essay"] * 3 + ["math"] * 3)
        self.assertEqual(totals(result), ({"essay": 180, "math": 180}, {}))

    def test_pressure_can_outweigh_grade_weight_in_shortage(self):
        data = payload()
        data["preferences"]["max_daily_study_minutes"] = 120
        data["tasks"][0].update(deadline="2026-11-13T10:00:00Z", remaining_minutes=60, grade_weight=30)
        data["tasks"][1].update(remaining_minutes=120, grade_weight=20)
        # Scores: urgent 30 * 60/60 = 30; later 20 * 120/120 = 20.
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))),
                         ({"essay": 60, "math": 60}, {"math": 60}))
        data["tasks"][1]["grade_weight"] = 40
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))),
                         ({"math": 120}, {"essay": 60}))

    def test_remaining_effort_affects_pressure(self):
        data = payload()
        data["preferences"]["max_daily_study_minutes"] = 120
        for task in data["tasks"]:
            task.update(deadline="2026-11-13T14:00:00Z", grade_weight=20)
        data["tasks"][0]["remaining_minutes"] = 60
        data["tasks"][1]["remaining_minutes"] = 120
        self.assertEqual(totals(generate_schedule(ScheduleRequest.model_validate(data))),
                         ({"math": 120}, {"essay": 60}))

    def test_full_response_is_deterministic_and_input_order_independent(self):
        data = payload()
        data["tasks"][1].update(grade_weight=40, deadline=data["tasks"][0]["deadline"])
        first = generate_schedule(ScheduleRequest.model_validate(data)).model_dump()
        self.assertEqual(generate_schedule(ScheduleRequest.model_validate(data)).model_dump(), first)
        data["tasks"].reverse()
        self.assertEqual(generate_schedule(ScheduleRequest.model_validate(data)).model_dump(), first)

    def test_constraints_locked_reservations_and_unfinished_accounting(self):
        data = payload()
        data["preferences"].update(max_daily_study_minutes=180, max_session_minutes=30, break_minutes=10)
        data["tasks"][1]["grade_weight"] = 80
        data["locked_blocks"] = [
            {"id": "unfinished", "task_id": "essay", "start": "2026-11-13T07:00:00Z",
             "end": "2026-11-13T07:30:00Z", "status": "unfinished", "locked": True},
            {"id": "completed", "task_id": "math", "start": "2026-11-13T07:30:00Z",
             "end": "2026-11-13T08:00:00Z", "status": "completed", "locked": True},
            {"id": "planned", "task_id": "essay", "start": "2026-11-13T09:00:00Z",
             "end": "2026-11-13T09:30:00Z", "status": "planned", "locked": True},
        ]
        data["events"] = [{"id": "lecture", "title": "Lecture", "start": "2026-11-13T10:00:00Z",
                           "end": "2026-11-13T11:00:00Z", "repeat_on": []}]
        request = ScheduleRequest.model_validate(data)
        before = request.model_dump()
        result = generate_schedule(request)
        self.assertEqual(request.model_dump(), before)
        planned, missing = totals(result)
        self.assertEqual(sum(planned.values()), 90)  # 90 locked minutes count toward daily cap.
        for task in request.tasks:
            reserved = 30 if task.id == "essay" else 0
            self.assertEqual(planned.get(task.id, 0) + reserved + missing.get(task.id, 0), task.remaining_minutes)
        for index, block in enumerate(result.study_blocks):
            self.assertGreaterEqual(block.start.hour, 9)
            self.assertLessEqual(block.end.hour, 14)
            self.assertLessEqual(block.end, next(task.deadline for task in request.tasks if task.id == block.task_id))
            self.assertLessEqual(block.end - block.start, timedelta(minutes=30))
            self.assertTrue(block.end <= request.events[0].start or block.start >= request.events[0].end)
            self.assertNotIn(block.id, {item.id for item in request.locked_blocks})
            for locked in request.locked_blocks:
                self.assertTrue(block.end + timedelta(minutes=10) <= locked.start or
                                block.start >= locked.end + timedelta(minutes=10))
            if index:
                self.assertGreaterEqual(block.start - result.study_blocks[index - 1].end, timedelta(minutes=10))

    def test_feasible_urgent_and_later_work_across_days(self):
        data = payload()
        data["preferences"].update(bedtime="12:00", max_daily_study_minutes=180, break_minutes=15)
        data["tasks"][0].update(deadline="2026-11-13T12:00:00Z", remaining_minutes=150)
        data["tasks"][1].update(deadline="2026-11-14T12:00:00Z", remaining_minutes=150, grade_weight=90)
        result = generate_schedule(ScheduleRequest.model_validate(data))
        self.assertEqual(totals(result), ({"essay": 150, "math": 150}, {}))
        self.assertEqual({block.start.day for block in result.study_blocks if block.task_id == "math"}, {14})

    def test_small_no_break_cases_against_exhaustive_feasibility(self):
        # Independent 15-minute-slot oracle: a commitment removes 09:15-09:30,
        # and the daily cap leaves only two of the three free slots usable.
        for effort_a, effort_b, due_a, due_b in product(range(1, 4), range(1, 4), (2, 4), (2, 4)):
            data = payload()
            data["preferences"].update(bedtime="10:00", max_daily_study_minutes=30, max_session_minutes=15)
            data["events"] = [{"id": "busy", "title": "Busy", "start": "2026-11-13T09:15:00Z",
                               "end": "2026-11-13T09:30:00Z", "repeat_on": []}]
            for task, effort, due in zip(data["tasks"], (effort_a, effort_b), (due_a, due_b)):
                task.update(remaining_minutes=effort * 15, deadline="2026-11-13T" + ("09:30" if due == 2 else "10:00") + ":00Z")
            feasible = any(
                assignments.count(0) == effort_a and assignments.count(1) == effort_b
                and sum(value != -1 for value in assignments) <= 2
                and all(value == -1 or minute + 1 <= (due_a, due_b)[value]
                        for minute, value in zip((0, 2, 3), assignments))
                for assignments in product((-1, 0, 1), repeat=3)
            )
            planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(data)))
            with self.subTest(effort=(effort_a, effort_b), deadlines=(due_a, due_b)):
                if feasible:
                    self.assertEqual(missing, {})
                for task in data["tasks"]:
                    self.assertEqual(planned.get(task["id"], 0) + missing.get(task["id"], 0), task["remaining_minutes"])

    def test_in_progress_planned_reserves_only_future_work(self):
        data = payload()
        data["tasks"][0]["remaining_minutes"] = 90
        data["locked_blocks"] = [{"id": "ongoing", "task_id": "essay", "start": "2026-11-13T07:30:00Z",
                                  "end": "2026-11-13T08:30:00Z", "status": "planned", "locked": True}]
        planned, missing = totals(generate_schedule(ScheduleRequest.model_validate(data)))
        self.assertEqual(planned.get("essay", 0) + missing.get("essay", 0) + 30, 90)
        self.assertEqual(planned.get("math", 0) + missing.get("math", 0), 180)
        self.assertEqual(sum(planned.values()), 180)  # Full locked hour counts against daily limit.

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
