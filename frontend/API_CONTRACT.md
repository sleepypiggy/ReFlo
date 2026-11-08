# Scheduling API contract (version 1)

Frontend mapping and validation live in `src/lib/apiAdapter.ts`. FastAPI implements
this contract in `backend/app/schedule_api.py` using the shared Python scheduler
and availability function. The prototype `/api/plan` endpoint remains supported.

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` in your local `frontend/.env.local`
(ignored by Git). This is also the default. Restart Next.js after changing it.
`GET /health` must return `{"status":"ok"}`; use **Test backend** in the footer.
FastAPI currently permits browser origins localhost:3000 and 127.0.0.1:3000.

## Request: POST /schedule

```json
{
  "contract_version": 1,
  "current_time": "2026-11-07T12:00:00.000Z",
  "timezone": "America/Vancouver",
  "tasks": [
    {
      "id": "task-1",
      "title": "CPSC problem set",
      "deadline": "2026-11-10T07:59:00.000Z",
      "estimated_minutes": 240,
      "remaining_minutes": 150,
      "grade_weight": 15
    }
  ],
  "events": [
    {
      "id": "event-1",
      "title": "Lecture",
      "start": "2026-11-09T17:00:00.000Z",
      "end": "2026-11-09T18:00:00.000Z",
      "repeat_on": [1, 3, 5]
    }
  ],
  "preferences": {
    "wake_up_time": "07:00",
    "bedtime": "23:00",
    "max_daily_study_minutes": 240,
    "max_session_minutes": 90,
    "break_minutes": 15
  },
  "locked_blocks": [
    {
      "id": "historical-block-1",
      "task_id": "task-1",
      "start": "2026-11-06T19:00:00.000Z",
      "end": "2026-11-06T20:30:00.000Z",
      "status": "completed",
      "locked": true
    }
  ]
}
```

- Datetimes are absolute ISO 8601 instants: requests use UTC `Z`; responses must
  include `Z` or an explicit `±HH:mm` offset. UI inputs and displays use browser local time.
- `timezone` is the browser's IANA zone. Sleep times and recurring event times are
  local wall times in this zone. Expand recurrence on the backend with DST handling.
  `repeat_on` uses JavaScript weekdays, Sunday 0 through Saturday 6. Empty means one-off.
  Repeats start no earlier than `start`, with no end date; expand only to the scheduling horizon.
  An overnight recurring event ends the following local day.
- `remaining_minutes` is authoritative and already reflects completed work. It can
  exceed the original estimate. Do not subtract historical sessions from it again.
- `locked_blocks` includes every completed, unfinished, explicitly locked, past,
  and in-progress block (`start <= current_time`). Their IDs and records must be
  preserved. Treat their time ranges as occupied. Past planned blocks are historical
  reservations, not proof of completion.
- An unfinished report marks the selected session `unfinished` and `locked`, then
  supplies the total assignment work remaining. No partial completion is inferred.
- Reserve fixed commitments, sleep, locked blocks, and breaks; respect daily/session
  limits and deadlines. One assignment may produce many independent sessions.

## Success response: HTTP 200

```json
{
  "study_blocks": [
    {
      "id": "new-unique-block-2",
      "task_id": "task-1",
      "start": "2026-11-08T19:00:00.000Z",
      "end": "2026-11-08T20:30:00.000Z",
      "status": "planned"
    }
  ],
  "unscheduled": [
    {
      "task_id": "task-1",
      "minutes": 60,
      "reason": "No further availability before the deadline."
    }
  ]
}
```

Return **only new future planned blocks**, not locked blocks; the frontend merges
the preserved history. IDs must be nonempty and unique, reference known tasks, and
not collide with locked IDs. New blocks must start at or after `current_time`, end
after their start and before the assignment deadline, and not overlap other study
blocks or fixed commitments. Include an `unscheduled` array even when empty. Minutes
must be nonnegative integers. New planned minutes plus unscheduled minutes must
account for remaining work, allowing for any still-planned locked sessions that
the backend treats as work reservations. Completed/unfinished/skipped blocks cannot consume
remaining work a second time.

Both first generation and rescheduling use this endpoint. Validation, HTTP, network,
and timeout failures preserve all existing blocks. An unfinished report remains
saved even if rescheduling fails, so Generate Schedule can retry. The UI never falls
back to mock data in backend mode. Responses are treated atomically.

## Demo behavior

Demo and real workspaces persist separately under `schedule-maker:v1`. Demo includes
authored lectures, volleyball, dinner, three assignments, and seven study sessions.
Generate replays existing sample sessions and reports uncovered remaining work; it
does not run a scheduling algorithm or claim to fit newly entered work. Switching
to real mode starts an empty independent workspace. FullCalendar only renders state.

## Implemented scheduling rules and limits

- Assignments share free time and daily study capacity. First try all remaining
  work in earliest-deadline order (task ID breaks ties), filling the earliest
  available slots. This reserves capacity for urgent work before flexible work
  uses it. Grade weight does not displace urgent work when this full plan fits.
- If the full plan does not fit, rank tasks by descending
  `grade_weight * unreserved_remaining_minutes / max(1, standalone_capacity)`.
  Standalone capacity is the minutes the session packer can place before that
  task's deadline with all preferences, events and locked history, but without
  other new work. This measures deadline pressure using actual study capacity,
  rather than elapsed clock time. Scores use exact rational arithmetic. Ties use
  earlier deadline, then greater remaining/capacity pressure, then task ID.
  Tasks with no standalone capacity receive a shortage. Zero-weight tasks follow
  positive-score tasks and use the same tie rules among themselves.
- Admit each ranked task's work while preserving previously admitted budgets.
  Each trial repacks all admitted work in deadline order, so a later task's
  higher score does not require it to occupy earlier slots. If the whole budget
  fails, binary search for a partial minute budget; then try lower-ranked tasks.
  Pressure scores are calculated once per request, not after each admission.
  Response ordering and generated IDs are deterministic and independent of task
  input order. There is no separate manual priority field.
- Tradeoffs: without breaks, divisible whole-minute work with a common release
  time admits a complete earliest-deadline allocation whenever one exists in the
  rounded available capacity. With nonzero breaks, task boundaries and fragmented
  windows introduce packing effects: this greedy feasibility check can miss a
  feasible arrangement. Binary search assumes monotonic packing feasibility;
  break placement can violate that assumption and leave capacity unused. The
  shortage policy prioritizes admitted minutes, not completed-task grade value,
  total throughput, or fairness, and does not guarantee a globally optimal plan.
  It uses the standard library and existing session engine; cached free windows
  avoid repeated event expansion. In shortage cases, up to one standalone trial
  and `1 + ceil(log2(remaining_minutes + 1))` admission trials per task may be
  needed, each repacking accepted work; large fragmented requests cost more.
- The shortage panel compares total remaining demand with the minutes covered by
  the current plan and lists unscheduled minutes for each affected task. These
  are allocations under the current weights and constraints, not a claim of
  raw free time or a globally optimal allocation. Users can edit grade weights
  and deadlines and regenerate. Edits persist even if regeneration fails; existing sessions
  are replaced only after a successful response. Demo mode does not reallocate.
- Daily limits use the requested timezone and count locked sessions on each day.
  New sessions have whole-minute durations; the current time rounds forward and
  free-window ends round backward so fractional seconds never cause overlap.
- Wake-up/bedtime can cross midnight. Recurring events retain local wall-clock
  times across DST; overnight commitments reserve both local days.
- Locked history is returned unchanged by frontend merging. Its occupied intervals
  and breaks are reserved. Completed/unfinished/skipped entries do not reduce remaining
  minutes again; only the future portion of still-planned locked sessions reserves
  remaining work. Past planned sessions imply no completion.
- Requests allow up to 200 tasks, 1,000 events and 2,000 locked blocks, with
  deadlines at most 366 days after current_time, timestamp years 0002?9997, and
  a 1 MB JSON request body. Minutes must be integers.
- Invalid input returns HTTP 400 with `error` and field-level `details`. Incorrect
  content type returns 415. `/health` and `/docs` are available on the same app.

See [the dashboard request fixture](../examples/schedule-request.json).
The sample dates are fixed for reproducibility; normal UI requests use its current
clock. Run `npm run test:live` to verify the three scenarios against actual Python.

## Progress, undo and backup behavior

`locked_blocks.status` also accepts `skipped`. Skips keep their original ID and
calendar interval, reserve the historical slot, and never reduce remaining work.
Skipped intervals do not consume the daily study budget or add study-break padding.
The frontend saves skip/unfinished reports before making the scheduling request,
so a failed request does not lose them.

After successful generation the UI compares task/time slots, ignoring regenerated
IDs, to show moved, added and removed session counts. Undo restores the calendar
from immediately before that request while retaining edits and progress reports.
Undo is one level, available until the next edit, workspace switch or page refresh.
It marks the restored plan as needing regeneration.

Upcoming study time excludes elapsed sessions and only counts the future portion
of in-progress planned sessions. Remaining work is the authoritative task total.
Shortage totals come from the last successful plan, not historical calendar entries.

JSON backups use `format: "schedule-maker-backup"`, `version: 1` and a `workspace`
containing both demo/real workspaces. Restore validates dates, IDs, references,
minutes and statuses and requires confirmation before replacing data.
The limit is 5 MB. Restored plans are marked for regeneration; no accounts or
remote storage are involved.

Changes to inputs set a persisted `needsReplan` flag. Old shortages are labeled as
belonging to the previous plan; regenerate to clear the badge and update totals.
