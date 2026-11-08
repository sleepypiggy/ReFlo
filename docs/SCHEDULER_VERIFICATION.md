# Scheduler verification

Run from the repository root with Python 3.11+ and the backend development
dependencies installed (use `backend/.venv/Scripts/python.exe` on Windows or
`backend/.venv/bin/python` on Unix if Python is not already in your environment):

```sh
python -m unittest -v test_scheduler_generated test_scheduler_reference
python test_scheduler_reference.py --report
python -m unittest discover -v
python demo_week.py
```

The first command runs the new checks. `--report` prints JSON measurements and
complete public `/schedule` request payloads for retained limitations; it does
not run tests. `unittest discover` includes these tests automatically in the
existing CI workflow. No new dependency, external service or production solver
is needed. The new tests take about 0.4 seconds locally, excluding interpreter
startup; this is a measurement, not a timing assertion.

## Generated invariants

`test_scheduler_generated.py` generates 72 requests with `random.Random` seeds
104729, 20261108 and 8675309. It combines one to three assignments, different
deadlines and weights, tiny/zero/uneven remaining estimates, fragmented fixed
events, daily recurring events with exclusions, all four locked statuses,
in-progress and future planned reservations, fractional current/history times,
breaks and daily/session limits. The same requests run with spacing off and on.
Every task permutation is checked with spacing off; reversed task order and
unchanged admitted minutes are checked with spacing on. Repeated calls must
produce the same entire response, including IDs, without mutating the request.

Checks use direct UTC interval intersections, local-clock minute sampling and
elapsed-time totals per local date. They do not call production availability,
packing, recurrence or accounting helpers. Assertions cover:

- Valid task references, unique IDs, stable ordering, whole-minute endpoints and
  durations between 15 minutes and the configured maximum.
- No overlap with fixed events, recurring occurrences, locked occupancy or other
  new blocks; study breaks around new blocks and non-skipped history.
- Deadlines, current time, waking hours and daily capacity. All non-skipped
  history consumes daily capacity, even if already completed or unfinished.
  Already overfull historical days receive no additional study minutes.
- For each task: new minutes + the lesser of remaining work and future planned
  locked reservation minutes + unscheduled minutes = remaining work. Historical
  completed/unfinished/skipped blocks never subtract progress again. Past planned
  portions do not reserve work. Whole-minute reservations round down per block,
  matching the public work-accounting contract; overreservations saturate at
  remaining work and cannot create negative shortages.

Fixtures cover UTC, Vancouver's spring transition, New York's autumn transition,
Berlin's autumn transition and Kathmandu's 45-minute offset. Explicit regressions
check a four-hour spring waking window, a six-hour autumn waking window, caps
across local midnight on a single UTC date, and a deadline in the second repeated
hour after current time in the first. Coverage assertions prevent the seeded
suite from passing with no new work or with an unexercised timezone.

Failures include the fixed seed, case index and full request JSON in their
subtest labels. The small exhaustive slot suite instead names its complete mask,
demands and deadlines. Preserve a minimized fixture when investigating a failure;
do not change a seed to avoid it.

## Independent exhaustive reference

`scheduler_reference.py` is test-only and imports no production scheduling code.
For at most three tasks and 75 elapsed whole minutes within a single local day,
it enumerates every legal start/end interval and all chronological combinations,
including idle choices. Dynamic-programming states merge only identical cursor
positions and admitted-minute vectors. It returns **all attainable vectors**,
without earliest-deadline ordering, greedy session sizes or binary search.
Events, locked occupancy, status-specific breaks, daily capacity, deadlines,
session limits and future planned reservations constrain each combination.
Hand-calculated tests check exact vector sets and touching boundaries.

The reference also computes exact standalone capacities and applies the documented
pressure score and tie rules to select a lexicographically preferred admission
vector. Full feasibility takes precedence over shortage ranking, as in production.
This comparison follows the existing minute-priority policy, rather than treating
maximum total throughput as the objective.

Comparisons include 64 seeded contiguous no-break cases (seed 32452843), 288
exhaustive aligned fragmented slot cases, and 48 seeded general cases (seed
32452844) with history and breaks. The first group compares complete feasibility
and the entire priority admission vector. The aligned group compares complete
feasibility and legal admitted vectors. General heuristic cases require the
production vector to be exactly attainable, without requiring global optimality.

The exact solver deliberately excludes multi-day/DST/recurring expansion and
fractional-minute inputs; those are covered by independent invariants, not by an
optimality claim. Its bound is enforced to keep CI practical. Passing these finite
comparisons is evidence within the tested domains, not a proof for arbitrary
requests. The solver is never imported by the application.

## Retained heuristic limitations

Minutes below use the fixtures in `test_scheduler_reference.py`. The JSON report
includes actual vectors, feasibility, the exact priority vector, maximum
throughput, gaps and the complete request. Tests enforce legality and current
priority performance as a lower bound, allowing future improvements to close
gaps without editing expected production results.

| Fixture | Production vector | Exact priority vector | Admitted-minute gap | Exact maximum throughput |
| --- | --- | --- | --- | --- |
| Minimum blocks without breaks | (15, 30) | (20, 30) | 5 | 50 |
| Fragmented windows with breaks | (19) | (32) | 13 | 32 |
| Nonmonotonic session packing | (25, 0) | (30, 0) | 5 | 30 |
| Daily-budget tail redistribution | (35, 0) | (45, 0) | 10 | 47 |

- **Minimum blocks:** 20- and 30-minute assignments share free windows 09:00–09:30
  and 09:35–09:55. Both are due 09:55. Scheduling the 30-minute task first fits
  all 50 minutes. Greedy deadline/ID packing starts with 20 minutes, strands a
  10-minute gap, and ultimately admits only 45. No breaks are necessary for this
  packing limitation: the 15-minute minimum prevents fully divisible work.
- **Fragmentation plus breaks:** a single task has windows 09:00–09:19 and
  09:20–09:35, a 25-minute maximum and a three-minute break. Taking 17 minutes
  first allows another 15 minutes at 09:20 (32 total). Greedy packing takes 19,
  then its required break leaves an unusable 13-minute tail.
- **Nonmonotonicity:** in a 35-minute window, a 25-minute maximum and five-minute
  break, the packer can place 25 minutes, fails to place 26, and can place 30 as
  15 + 15. Thus binary-search assumptions are unsafe, and standalone capacity
  can also be underestimated. A focused test retains that exact feasibility
  sequence independently of the endpoint's final admission.
- **Daily-budget tails:** a 50-minute daily cap, 45-minute session maximum and
  three-minute break cause a standalone-capacity probe to reserve a 15-minute
  tail and shorten its first block to 35. With the task due after 45 minutes the
  tail cannot fit, although a single 45-minute block can. The reference's
  priority objective admits (45, 0); a different (32, 15) allocation can maximize
  throughput at 47. The scheduler is not required to pursue that objective.

These are measured limitations, not correctness exceptions: all returned blocks
must still satisfy every invariant. No policy or global optimizer was added.

## Correctness fix found by these checks

The repeated-hour regression failed before the fix with
`ValueError: planning_end must be after planning_start`. At New York's fall-back,
01:45 EDT (05:45 UTC) precedes 01:30 EST (06:30 UTC), but comparing two Python
datetimes with the same `ZoneInfo` orders their local clocks without considering
the fold. Dashboard allocation and spacing now clip waking boundaries in UTC,
using the existing local-boundary conversion. The 45 elapsed minutes remain
available, so the 30-minute task is scheduled. The legacy `/api/plan` endpoint
and its shared availability/packing implementations are unchanged.
