"""Bounded exact comparisons; run with --report to print retained heuristic gaps."""

import json
import random
import sys
import unittest
from datetime import datetime, timedelta
from itertools import product

from backend.app.schedule_api import ScheduleRequest, generate_schedule
from backend.app.scheduler import Assignment, Window, schedule_assignment
from scheduler_reference import TinyProblem, attainable, payload, preferred_vector, priority_order
from test_scheduler_generated import admitted, verify

REFERENCE_SEED = 32452843

# These are measurements, not desired policy changes or expected failures.
# The lower bound freezes current performance while allowing future improvements.
LIMITATIONS = (
    ("minimum_blocks_without_breaks",
     TinyProblem(55, (20, 30), (55, 55), maximum=30, events=((30, 35),)), (15, 30)),
    ("fragmented_windows_with_breaks",
     TinyProblem(35, (40,), (35,), maximum=25, pause=3, daily=35, events=((19, 20),)), (19,)),
    ("nonmonotonic_session_packing",
     TinyProblem(40, (40, 15), (35, 35), maximum=25, pause=5, daily=40), (25, 0)),
    ("daily_budget_tail_redistribution",
     TinyProblem(50, (45, 15), (45, 50), maximum=45, pause=3, daily=50, weights=(40, 40)), (35, 0)),
)


def measure(name, problem):
    data = payload(problem)
    result = generate_schedule(ScheduleRequest.model_validate(data))
    actual = admitted(data, result)
    vectors = attainable(problem)
    reference = preferred_vector(problem)
    return {"case": name, "request": data, "production": actual, "reference_priority": reference,
            "production_full_feasibility": actual == problem.unreserved(),
            "reference_full_feasibility": problem.unreserved() in vectors,
            "priority_total_gap": sum(reference) - sum(actual),
            "reference_max_throughput": max(map(sum, vectors)),
            "throughput_gap": max(map(sum, vectors)) - sum(actual)}


class ReferenceSolverTests(unittest.TestCase):
    def test_oracle_known_vectors_and_boundaries(self):
        self.assertEqual(attainable(TinyProblem(15, (15, 15), (15, 15))),
                         {(0, 0), (15, 0), (0, 15)})
        self.assertEqual(attainable(TinyProblem(30, (30,), (30,), maximum=15)), {(0,), (15,), (30,)})
        self.assertEqual(attainable(TinyProblem(30, (30,), (30,), maximum=15, pause=1)), {(0,), (15,)})
        self.assertEqual(attainable(TinyProblem(31, (30,), (31,), maximum=15, pause=1)), {(0,), (15,), (30,)})
        self.assertEqual(attainable(TinyProblem(29, (30,), (29,), maximum=15)), {(0,), (15,)})
        self.assertEqual(attainable(TinyProblem(30, (30,), (14,))), {(0,)})
        self.assertEqual(attainable(TinyProblem(30, (30,), (30,), events=((14, 16),))), {(0,)})
        self.assertEqual(attainable(TinyProblem(30, (30,), (30,), daily=14)), {(0,)})
        # Skips consume occupancy only. Study history consumes daily capacity
        # and imposes breaks, even if it does not reduce remaining work.
        for status in ("planned", "completed", "unfinished", "skipped"):
            p = TinyProblem(30, (30,), (30,), maximum=15, daily=30,
                            history=((0, -15, 0, status),))
            self.assertEqual(p.unreserved(), (30,))
            self.assertEqual(attainable(p), {(0,), (15,), (30,)} if status == "skipped" else {(0,), (15,)})
        p = TinyProblem(30, (25,), (30,), history=((0, -5, 10, "planned"),))
        self.assertEqual(p.unreserved(), (15,))
        self.assertEqual(attainable(p), {(0,), (15,)})
        with self.assertRaises(ValueError):
            attainable(TinyProblem(76, (15,), (76,)))

    def test_no_break_contiguous_cases_match_feasibility_and_priority_admission(self):
        # One contiguous same-day interval, no breaks and no session splitting:
        # min-block constraints remain in force, but packing has no small gaps.
        # Compare the whole priority vector, not merely summed throughput.
        rng = random.Random(REFERENCE_SEED)
        for index in range(64):
            horizon = rng.choice((15, 30, 45, 60))
            count = rng.choice((1, 2, 3))
            p = TinyProblem(horizon,
                            tuple(rng.choice((0, 8, 15, 16, 20, 30, 45)) for _ in range(count)),
                            tuple(rng.choice((15, horizon)) for _ in range(count)), maximum=75,
                            daily=rng.choice((15, 30, 45, 60)),
                            weights=tuple(rng.choice((0, 1, 20, 50)) for _ in range(count)))
            data = payload(p)
            with self.subTest(seed=REFERENCE_SEED, case=index, request=json.dumps(data, sort_keys=True)):
                result = generate_schedule(ScheduleRequest.model_validate(data))
                verify(self, data, result)
                actual = admitted(data, result)
                self.assertEqual(actual, preferred_vector(p))
                self.assertEqual(not result.unscheduled, p.unreserved() in attainable(p))

    def test_aligned_fragmented_no_break_full_feasibility(self):
        # Exhaustively vary a 3-slot mask and the two tasks' demands/deadlines.
        # Here max=min=15, all boundaries/budgets are multiples of 15, and work
        # fits exactly in slots; this isolates the divisible-work EDF guarantee.
        for mask, work_a, work_b, due_a, due_b in product(range(8), (0, 15, 30), (0, 15, 30), (15, 45), (15, 45)):
            p = TinyProblem(45, (work_a, work_b), (due_a, due_b), maximum=15, daily=30,
                            events=tuple((slot * 15, (slot + 1) * 15) for slot in range(3) if mask & (1 << slot)))
            data = payload(p)
            with self.subTest(mask=mask, work=p.demands, deadlines=p.deadlines):
                result = generate_schedule(ScheduleRequest.model_validate(data))
                vectors = attainable(p)
                self.assertIn(admitted(data, result), vectors)
                self.assertEqual(not result.unscheduled, p.unreserved() in vectors)

    def test_generated_general_cases_are_exactly_legal_without_optimality_assumption(self):
        rng = random.Random(REFERENCE_SEED + 1)
        for index in range(48):
            horizon = rng.choice((30, 35, 40, 45, 50))
            count = rng.choice((1, 2))
            event_start = rng.randrange(0, horizon - 1)
            history_start = rng.choice((-20, -5, 15))
            p = TinyProblem(horizon, tuple(rng.choice((8, 15, 16, 20, 30, 40)) for _ in range(count)),
                            tuple(rng.choice((15, horizon)) for _ in range(count)),
                            maximum=rng.choice((15, 20, 30)), pause=rng.choice((0, 1, 3, 5)),
                            daily=rng.choice((15, 30, 45, 60)),
                            events=((event_start, min(horizon, event_start + rng.choice((1, 5, 15)))),),
                            history=((0, history_start, history_start + 10,
                                      rng.choice(("planned", "completed", "unfinished", "skipped"))),))
            data = payload(p)
            with self.subTest(seed=REFERENCE_SEED + 1, case=index, request=json.dumps(data, sort_keys=True)):
                result = generate_schedule(ScheduleRequest.model_validate(data))
                verify(self, data, result)
                self.assertIn(admitted(data, result), attainable(p))

    def test_retained_limitations_are_measured_not_required_to_be_optimal(self):
        expected_reference = ((20, 30), (32,), (30, 0), (45, 0))
        for (name, p, baseline), expected in zip(LIMITATIONS, expected_reference):
            with self.subTest(case=name, request=payload(p)):
                report = measure(name, p)
                actual = report["production"]
                self.assertIn(actual, attainable(p))
                self.assertEqual(report["reference_priority"], expected)
                # A future improvement may close the gap. Regressions in the
                # current policy's lexicographic admitted vector still fail.
                order = priority_order(p)
                self.assertGreaterEqual(tuple(actual[i] for i in order), tuple(baseline[i] for i in order))

    def test_packer_feasibility_is_not_monotonic_in_requested_minutes(self):
        base = datetime(2026, 11, 10, 9)
        feasibility = {}
        for work in (25, 26, 30):
            p = TinyProblem(35, (work,), (35,), maximum=25, pause=5)
            result = schedule_assignment(Assignment("Work", work, base + timedelta(minutes=35)),
                                         [Window(base, base + timedelta(minutes=35))],
                                         max_session_minutes=25, break_minutes=5, min_session_minutes=15)
            feasibility[work] = result.unscheduled_minutes == 0
            self.assertEqual(feasibility[work], (work,) in attainable(p))
        self.assertEqual(feasibility, {25: True, 26: False, 30: True})
        self.assertIn((30,), attainable(TinyProblem(35, (30,), (35,), maximum=25, pause=5)))


if __name__ == "__main__":
    if sys.argv[1:] == ["--report"]:
        print(json.dumps([measure(name, problem) for name, problem, _ in LIMITATIONS], indent=2))
    else:
        unittest.main()
