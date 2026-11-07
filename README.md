# Replan scheduling engine

The scheduler and local API use only Python's standard library (Python 3.9+).
From the repository root, start the API with:

```sh
python3 api.py --port 8000
```

It listens on `127.0.0.1` only. Stop it with Ctrl-C. This is a local development
server with no persistence: the caller sends the current state on every request.

## Frontend contract: `POST /api/plan`

Send `Content-Type: application/json`. All fields shown below are required.
The same endpoint supports initial planning (`existing_blocks: []`) and replanning.

```sh
curl -sS http://127.0.0.1:8000/api/plan \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "assignment": {
    "title": "Statistics assignment",
    "deadline": "2026-11-12T19:15:00-08:00"
  },
  "remaining_minutes": 240,
  "now": "2026-11-10T15:00:00-08:00",
  "existing_blocks": [],
  "available_windows": [
    {"start": "2026-11-10T16:00:00-08:00", "end": "2026-11-10T18:15:00-08:00"},
    {"start": "2026-11-11T09:00:00-08:00", "end": "2026-11-11T11:15:00-08:00"},
    {"start": "2026-11-12T18:15:00-08:00", "end": "2026-11-12T19:15:00-08:00"}
  ],
  "max_session_minutes": 60,
  "break_minutes": 15
}
JSON
```

HTTP 200 response (formatted for readability):

```json
{
  "past_blocks": [],
  "future_blocks": [
    {"title": "Statistics assignment", "start": "2026-11-11T00:00:00Z", "end": "2026-11-11T01:00:00Z"},
    {"title": "Statistics assignment", "start": "2026-11-11T01:15:00Z", "end": "2026-11-11T02:15:00Z"},
    {"title": "Statistics assignment", "start": "2026-11-11T17:00:00Z", "end": "2026-11-11T18:00:00Z"},
    {"title": "Statistics assignment", "start": "2026-11-11T18:15:00Z", "end": "2026-11-11T19:15:00Z"}
  ],
  "future_scheduled_minutes": 240,
  "unscheduled_minutes": 0
}
```

### Datetimes and field semantics

- Every datetime must be minute-aligned ISO 8601: `YYYY-MM-DDTHH:MM:00Z` or
  `YYYY-MM-DDTHH:MM:00±HH:MM`. Offsets are mandatory; seconds must be `00` and
  fractional seconds are not accepted. Normalize browser `toISOString()` values
  to minute precision and remove `.000` before sending. Responses always use UTC
  `YYYY-MM-DDTHH:MM:00Z`. Display them in the student's timezone; UTC dates may
  differ from the local calendar date. The example uses Vancouver's November offset.
- `remaining_minutes` is the student's current estimate, a nonnegative integer.
  Past entries do not imply completed work and are not subtracted from this estimate.
- `now` is the replanning cutoff. Existing blocks starting before it are preserved
  in `past_blocks`, including any in-progress block in full. Blocks starting exactly
  at `now` or later are replaced. New work starts no earlier than `now`, respects
  breaks after preserved entries, and ends at or before the deadline.
- `existing_blocks` contains only this assignment's entries, each with matching
  `title`, `start`, and `end`. On the next request, concatenate the previous
  `past_blocks` and `future_blocks`. Replace the assignment's future calendar entries
  with the returned `future_blocks`; retain `past_blocks` without duplicating them.
- `available_windows` contains free intervals (`start`, `end`) after other
  commitments have been removed by the caller. To add the Thursday shift, remove
  Thursday's window. Both windows and blocks must end after they start.
- `max_session_minutes` is a positive integer; `break_minutes` is a nonnegative
  integer. Defaults are not assumed by the API; send both explicitly.
- `future_scheduled_minutes` counts only the returned future blocks.
  `unscheduled_minutes` is remaining work that cannot fit before the deadline.
  These two counts sum to `remaining_minutes`.

For the Tuesday evening replan, send `now: "2026-11-10T20:00:00-08:00"`,
`remaining_minutes: 180`, and all four baseline blocks as `existing_blocks`.
The response preserves Tuesday's two entries and schedules Wednesday's 120 minutes
plus Thursday's 60 minutes: **180 scheduled / 0 unscheduled**. Repeat with those
returned entries and Thursday's window removed: **120 scheduled / 60 unscheduled**.

Invalid requests return HTTP 400 with `{"error": "..."}`; a non-JSON content type
returns 415 and an unknown POST path returns 404. Bodies are limited to 1 MB.
The API allows CORS and OPTIONS preflight from `http://localhost:3000` and
`http://127.0.0.1:3000`, the local Next.js development origins. Browser callers can
use `fetch("http://127.0.0.1:8000/api/plan", {method: "POST", headers:
{"Content-Type": "application/json"}, body: JSON.stringify(payload)})`.

## Verification

```sh
python3 demo_week.py
python3 -m unittest -v test_api.py
```

The demo checks all three plans. The HTTP tests start an ephemeral loopback server
and verify the 240/0, 180/0, and 120/60 results, preserved entries, UTC conversion,
validation errors, and CORS preflight. No frontend changes are needed for these checks.
