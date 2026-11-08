# Scheduling API contract (provisional, version 1)

The source of truth for frontend JSON mapping and validation is `src/lib/apiAdapter.ts`.
The Python scheduler is not implemented by this frontend. No backend files were changed.

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
the backend treats as work reservations. Completed/unfinished blocks cannot consume
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
