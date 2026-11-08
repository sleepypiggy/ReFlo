"""Test-only exact solver for one-day, whole-minute problems (at most 75 minutes).

No production scheduling imports. Enumerate every legal interval and every
chronological combination, including idle minutes. States with the same cursor
and admitted vector are equivalent; no greedy packing or binary search is used.
"""

from dataclasses import dataclass
from fractions import Fraction


@dataclass(frozen=True)
class TinyProblem:
    horizon: int
    demands: tuple[int, ...]
    deadlines: tuple[int, ...]
    maximum: int = 30
    pause: int = 0
    daily: int = 75
    events: tuple[tuple[int, int], ...] = ()
    # task index, start, end, status. Negative offsets are same-day past history.
    history: tuple[tuple[int, int, int, str], ...] = ()
    weights: tuple[int, ...] = ()

    def unreserved(self):
        return tuple(max(0, work - sum(max(0, end - max(0, start))
                     for task, start, end, status in self.history
                     if task == index and status == "planned"))
                     for index, work in enumerate(self.demands))


def attainable(problem: TinyProblem, budgets=None) -> frozenset[tuple[int, ...]]:
    """All attainable admitted vectors, not just a maximum-total solution.

    Intervals are half-open. Breaks surround actual study history, while skipped
    history reserves occupancy only. Fixed events do not require study breaks.
    All history is within the same local day; DST and recurrence are tested by
    the separate UTC invariant suite, outside this deliberately bounded solver.
    """
    if not 0 <= problem.horizon <= 75 or not 1 <= len(problem.demands) <= 3:
        raise ValueError("Reference solver supports 0..75 minutes and 1..3 tasks")
    budgets = problem.unreserved() if budgets is None else tuple(budgets)
    occupied = list(problem.events)
    used = 0
    for _, start, end, status in problem.history:
        padding = problem.pause if status != "skipped" else 0
        occupied.append((start - padding, end + padding))
        if status != "skipped":
            used += end - start
    free = [not any(start < minute + 1 and end > minute for start, end in occupied)
            for minute in range(problem.horizon)]
    # Generate the legal intervals independently of task order or work budgets.
    candidates = [[] for _ in range(problem.horizon)]
    for start in range(problem.horizon):
        for end in range(start + 15, min(problem.horizon, start + problem.maximum) + 1):
            if all(free[start:end]):
                candidates[start].append(end)
    zero = (0,) * len(budgets)
    states = [set() for _ in range(problem.horizon + problem.pause + 1)]
    states[0].add(zero)
    reached = {zero}
    for start in range(problem.horizon):
        for vector in states[start]:
            states[start + 1].add(vector)  # Deliberately idle; later starts may fit better.
            for end in candidates[start]:
                length = end - start
                if used + sum(vector) + length > problem.daily:
                    continue
                for task in range(len(budgets)):
                    if end > problem.deadlines[task] or vector[task] + length > budgets[task]:
                        continue
                    after = list(vector)
                    after[task] += length
                    after = tuple(after)
                    reached.add(after)
                    states[end + problem.pause].add(after)
    return frozenset(reached)


def priority_order(problem: TinyProblem):
    """Contract score using exact standalone capacities, with stable a/b/c IDs."""
    demand = problem.unreserved()
    capacities = []
    for task in range(len(demand)):
        budget = tuple(problem.horizon if index == task else 0 for index in range(len(demand)))
        capacities.append(max(vector[task] for vector in attainable(problem, budget)))
    weights = problem.weights or (1,) * len(demand)
    return tuple(sorted(range(len(demand)), key=lambda task: (
        -weights[task] * Fraction(demand[task], max(1, capacities[task])),
        problem.deadlines[task], -Fraction(demand[task], max(1, capacities[task])), task)))


def preferred_vector(problem: TinyProblem):
    """Reference admission preserves higher-priority minutes, not throughput."""
    vectors = attainable(problem)
    demand = problem.unreserved()
    if demand in vectors:
        return demand
    order = priority_order(problem)
    return max(vectors, key=lambda vector: tuple(vector[task] for task in order))


def payload(problem: TinyProblem):
    """Translate minute offsets at 09:00 UTC into the public dashboard contract."""
    from datetime import datetime, timedelta, timezone

    base = datetime(2026, 11, 10, 9, tzinfo=timezone.utc)
    stamp = lambda minute: (base + timedelta(minutes=minute)).isoformat()
    return {
        "contract_version": 1, "current_time": stamp(0), "timezone": "UTC",
        "tasks": [{"id": chr(97 + task), "title": chr(65 + task),
                   "estimated_minutes": work, "remaining_minutes": work,
                   "deadline": stamp(problem.deadlines[task]),
                   "grade_weight": (problem.weights or (1,) * len(problem.demands))[task]}
                  for task, work in enumerate(problem.demands)],
        "preferences": {"wake_up_time": "09:00", "bedtime": "12:00",
                        "max_daily_study_minutes": problem.daily,
                        "max_session_minutes": problem.maximum, "break_minutes": problem.pause,
                        "spread_assignments": False},
        "events": [{"id": f"event-{index}", "title": "Busy", "start": stamp(start),
                    "end": stamp(end), "repeat_on": []} for index, (start, end) in enumerate(problem.events)],
        "locked_blocks": [{"id": f"history-{index}", "task_id": chr(97 + task),
                           "start": stamp(start), "end": stamp(end), "status": status, "locked": True}
                          for index, (task, start, end, status) in enumerate(problem.history)],
    }
