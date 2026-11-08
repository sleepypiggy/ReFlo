# Schedule Maker

## Description

An AI scheduler app that imports your schedule, activities, and assignments and automatically updates your schedule to help you manage your time throughout the week.

## Pitch

Balancing work and social life is hard for students, and the transition from having a mostly fixed schedule in high school to having much more freedom makes it hard to manage your time. Our app helps you manage your time productively while allowing you to enjoy your personal time.

## Key Goals

- Import your schedule for each week and plan work times for your tasks.
- Allow you to update your schedule by adding or canceling activities.
- Include an **“I didn’t finish” / “I skipped”** feature that updates your schedule to give you more time to finish.
- Ask you which tasks to prioritize if there is a shortage of time.
- Allow you to estimate how much time you need to work, while also providing its own estimate.
- Include a sleep cutoff that allows you to set your wake-up time and bedtime.
- Allow you to set maximum study session lengths, preferred break durations, and maximum work or study time per day.

## Refined Key Goals

1. **Build a weekly study plan around fixed commitments.** Let students add classes, work shifts, meals, and other activities, then enter their assignments, deadlines, and estimated work time. Schedule study blocks in the available time before each deadline.
2. **Keep the plan up to date as activities change.** Let students add, edit, or cancel activities and update the affected study blocks.
3. **Replan unfinished work.** Let students select **“I didn’t finish”** and enter how much work remains. Reallocate upcoming study time, preserve past calendar entries, and show what changed.
4. **Respect sleep and study preferences.** Let students set their wake-up time, bedtime, maximum study session length, and break duration. Use those preferences when generating and updating the plan.
5. **Show when work does not fit.** Display the scheduled and unscheduled time for each assignment so students can see how much work still needs a slot before the deadline.

## Stretch Goal

**Suggest editable time estimates.** When students are unsure how long an assignment will take, offer a suggested range based on the task type or their past estimates for similar work. Let students adjust the estimate before generating the plan.

## Team Members

- [Randy Du](https://github.com/sleepypiggy)
- [George Li](https://github.com/vermoshrank)
- [Edward Lau](https://github.com/lauedward82-cloud)
- [Kevin Li](https://github.com/Kevin968k)

## Current Planning Improvements

The prototype uses feasibility-first scheduling with weighted deadline pressure, a saved
plan-update indicator, replanning summaries with undo, and an **I Skipped** action.
The dashboard separates remaining, upcoming and unscheduled time. JSON backup and
restore work for both demo and real workspaces, with validation and confirmation.
See [the frontend guide](frontend/README.md#planning-controls-and-backups) for details.
Automated project checks are defined in `.github/workflows/checks.yml`.

Study sessions that cannot be dragged show a lock icon. Hover over the block or
open it (click, Enter or Space) to see the specific reason: past time, already
started, locked, completed, unfinished or skipped history. Move failures explain
deadline, sleep, fixed-event, break and daily-limit conflicts without changing
the saved plan. Indicators refresh as sessions reach their start time.

## Study Spacing

The dashboard now spreads assignment work across available days by default, with
more space between new sessions when it fits. Tight deadlines can still require
consecutive sessions. Toggle **Spread study sessions across days** in Preferences
and regenerate to apply it. Scheduled minutes and shortage priorities are preserved.
See [the spacing contract](frontend/API_CONTRACT.md#study-spacing) for details.

New study sessions have a 15-minute minimum. Session lengths can vary (for
example, 60 + 45 minutes); small gaps are skipped rather than turned into tiny
sessions. Any work that cannot fit under these limits is shown as unscheduled.

In Real backend mode, adding, editing or importing a fixed event that overlaps
future study automatically regenerates the plan. Event times stay fixed; study
sessions move around them. Past, started and locked entries are preserved. If
replanning fails, the event remains saved and Generate Schedule retries the plan.

After a real replan, **What changed** compares previous and new study times,
lists added or removed sessions, and shows unscheduled minutes. Changed sessions
are outlined and labeled **Updated** on the calendar. Dismiss the review to clear
highlights, or use **Undo last replan** to restore the previous study calendar
while retaining saved commitments and task progress. Reviews last for the current
visit and clear when you edit the plan or refresh.

Assistant previews also show removed and added study slots and each affected
assignment's scheduled and unscheduled minutes before you choose **Apply**.
Discarding a preview leaves the saved plan unchanged. After Apply, the regular
change-review panel and calendar highlights show the applied changes.

## API Integration

The optional Gemini `POST /assistant/chat` endpoint powers a conversational
assignment/event assistant with missing-field questions and an Apply/Cancel
schedule preview. The legacy event-only `/assistant/parse` endpoint remains
available. See [assistant setup and draft contract](docs/ASSISTANT_API.md).
Calendar scheduling works without a Gemini key.

### Dashboard endpoint: `POST /schedule`

The dashboard now connects to the real FastAPI scheduler through `/schedule`.
Use **Real backend** as the data source and click **Generate Schedule**. It accepts
multiple tasks, fixed events, preferences, and locked history, then returns
`study_blocks` and `unscheduled` as expected by the frontend. It handles recurring
commitments, sleep, daily/session limits, breaks, and unfinished work.
It tries all work in deadline order first. On shortage, priority combines grade
weight with remaining effort relative to available study capacity before each
deadline, while placing admitted work in deadline order. See the contract's
[scheduling policy and tradeoffs](frontend/API_CONTRACT.md#implemented-scheduling-rules-and-limits).

- [Dashboard JSON contract](frontend/API_CONTRACT.md)
- [Example dashboard request](examples/schedule-request.json)
- [Frontend setup and live browser test](frontend/README.md#live-backend-verification)

From the repository root, run the complete Python checks:

```powershell
.\backend\.venv\Scripts\python.exe -m unittest -v test_api test_availability test_schedule test_priorities
```

From `frontend`, run `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`,
`npm.cmd run test:e2e`, and `npm.cmd run test:live`. The last command starts isolated
frontend and backend servers and exercises actual Python scheduling through the UI.
The existing browser regression suite uses intercepted responses for error cases;
the live suite uses real HTTP and verifies all three scheduling scenarios.

### Prototype endpoint: `POST /api/plan`

The following single-assignment contract remains supported for the original demo.

The planning API now lives in the existing **FastAPI backend** at
`backend/app/api.py`. It calls `backend/app/scheduler.py` and
`backend/app/availability.py`, integrated from the teammate's
`backend-availability` branch. The scheduler's algorithm is unchanged; the
availability module only uses a package-relative import.

**Endpoint: `POST http://127.0.0.1:8000/api/plan`**

The same endpoint schedules and replans one assignment. No state is stored:
send the current assignment, windows, and existing blocks on each request.
The original prototype payload and successful response format are preserved.
See [the frontend handoff](docs/FRONTEND_API.md) for a concise integration guide.

### Setup and Run

From the repository root in Windows PowerShell:

```powershell
# Create the environment only if it does not already exist:
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

On macOS/Linux, using your active Python environment:

```bash
python3 -m pip install -r backend/requirements-dev.txt
python3 -m uvicorn backend.app.main:app --reload --port 8000
```

For runtime dependencies only, install `backend/requirements.txt` instead.
The existing command from inside `backend`,
`python -m uvicorn app.main:app --reload`, also works. The root
`python api.py --port 8000` command is retained as a launcher for this same FastAPI
app. Run only one server on the port. Stop it with Ctrl+C.

- Interactive API documentation: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>
- OpenAPI schema: <http://127.0.0.1:8000/openapi.json>

Run `npm run dev` from `frontend` in a separate terminal (`npm install` on initial
setup). Each teammate needs a local API process: `127.0.0.1` refers to the computer
running the browser. The dashboard uses `/schedule`; the prototype endpoint below remains available
for direct API testing.

### Request Contract

Send `Content-Type: application/json`. Use
[`examples/plan-request.json`](examples/plan-request.json) as the first browser
integration payload. It schedules the Statistics assignment using the three
sample windows, with maximum sessions of 60 minutes and 15-minute breaks.

```json
{
  "assignment": {
    "title": "Statistics assignment",
    "deadline": "2026-11-12T19:15:00-07:00"
  },
  "remaining_minutes": 240,
  "now": "2026-11-10T15:00:00-07:00",
  "existing_blocks": [],
  "available_windows": [
    {"start": "2026-11-10T16:00:00-07:00", "end": "2026-11-10T18:15:00-07:00"},
    {"start": "2026-11-11T09:00:00-07:00", "end": "2026-11-11T11:15:00-07:00"},
    {"start": "2026-11-12T18:15:00-07:00", "end": "2026-11-12T19:15:00-07:00"}
  ],
  "max_session_minutes": 60,
  "break_minutes": 15
}
```

All fields above are required. Unknown fields are rejected with a validation error. Minutes must be integers (not booleans or numeric
strings); remaining work and breaks may be zero, and session length must be positive.
Every interval must end after it starts. Existing block titles must match the
assignment title. The API uses the prototype `title` contract rather than the
frontend's `Task` shape; map `Task.name` to `assignment.title` and
`Task.remainingTimeMinutes` to `remaining_minutes`. Keep the task ID in frontend
state to identify which assignment's displayed plan to replace.

Timestamps must be minute-aligned ISO 8601 with an explicit offset:
`YYYY-MM-DDTHH:MM:00Z` or `YYYY-MM-DDTHH:MM:00?HH:MM`. Fractional seconds and
naive timestamps are rejected. A browser `Date` can be serialized with
`date.toISOString().replace(/\.000Z$/, "Z")` **after** checking that its seconds
and milliseconds are zero. Never simply append `Z` to a local time.
Responses always use UTC `Z`, including across different input offsets.
The sample uses current IANA Vancouver offsets; the scheduler teammate's original
regression fixtures retain their explicit `-08:00` offsets as fixed instants.

### Response and Calendar Rendering

The response contains:

- `past_blocks`: started entries preserved in full, including in-progress blocks.
- `future_blocks`: newly scheduled study blocks, each with `title`, `start`, `end`.
- `future_scheduled_minutes`: minutes in future blocks only.
- `unscheduled_minutes`: remaining work that does not fit before the deadline.

The two minute counts sum to the submitted `remaining_minutes`. Past entries do not
imply completed work and are not subtracted from the student's estimate.

The frontend teammate can load the JSON fixture and call:

```typescript
async function generatePlan(payload: unknown) {
  const response = await fetch("http://127.0.0.1:8000/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Planning failed");
  return result;
}

// In the calendar's handler, use your current single assignment's ID:
// const result = await generatePlan(payload);
// const blocks = [...result.past_blocks, ...result.future_blocks];
// const calendarEvents = blocks.map((block) => ({
//   ...block,
//   id: `${taskId}:${block.start}:${block.end}`,
//   extendedProps: { taskId },
// }));
```

Replace this assignment's displayed plan with the combined arrays; do not append
another copy of past entries. Preserve other assignments and fixed events.
Configure FullCalendar to display in **America/Vancouver**, with named-timezone
support such as `@fullcalendar/luxon3` configured by the frontend owner. Preserve
UTC timestamps and let the calendar convert them. Plain `timeZone: "local"` is
suitable only when the browser's local timezone is Vancouver.

For a PowerShell HTTP check, in a second terminal at the root:

```powershell
$plan = Invoke-RestMethod -Uri http://127.0.0.1:8000/api/plan -Method Post -ContentType 'application/json' -InFile examples/plan-request.json
$plan.future_blocks | Format-Table title, start, end
$plan | Select-Object future_scheduled_minutes, unscheduled_minutes
```

### Unfinished Work and Fixed Events

For **I didn't finish**, send `remaining_minutes: 180`, set `now` to Tuesday
November 10 at 20:00 with the same offset as the sample, and send the previous
`past_blocks` plus `future_blocks` as `existing_blocks`. Keep the original windows.
Blocks starting before `now` remain visible; blocks starting exactly at `now`
or later are replaced. New work respects the cutoff, deadline, and breaks.

For the first work-shift demo, remove the Thursday window from `available_windows`.
The optional `availability` field also connects the scheduling teammate's
`available_study_windows` function, so the API can subtract fixed events and
respect daily waking hours without changing scheduling logic:

```json
{
  "timezone": "America/Vancouver",
  "wake_up": "07:00",
  "bedtime": "23:00",
  "fixed_events": [
    {"start": "2026-11-12T18:15:00-07:00", "end": "2026-11-12T19:15:00-07:00"}
  ]
}
```

Add that object as `availability` alongside the original request fields. Each
supplied window is filtered by local waking hours and fixed events before being
passed to the scheduler in UTC. Omitting it preserves the baseline behavior:
`available_windows` must already be free of conflicts. Wake-up and bedtime use
`HH:mm` with `wake_up < bedtime`; overnight waking periods are not supported by
the current availability function. Maximum daily study time and multiple
assignments are not implemented in this baseline.

| Browser action | Expected result |
| --- | --- |
| Generate Plan | Two one-hour Tuesday blocks and two Wednesday blocks; 240 scheduled / 0 unscheduled. |
| Report 180 minutes remaining Tuesday evening | Tuesday preserved; 120 future minutes Wednesday and 60 Thursday; 180 / 0. |
| Remove Thursday availability, or supply the full Thursday shift | Tuesday preserved; 120 future minutes Wednesday; 120 / 60. |

### Troubleshooting and Verification

- **400:** The JSON response's `error` explains missing fields, invalid timestamps,
  intervals, or minute values. Validation responses also include a `details` list
  with field paths (`loc`), messages, and types. Requests are limited to 1 MB.
- **415:** Send `Content-Type: application/json`.
- **405:** `/api/plan` requires POST; opening it in the address bar sends GET.
- **Connection refused:** Start FastAPI with the command above and check `/health`.
- **Unexpected response:** Stop any older server on port 8000 and restart the
  current FastAPI app. The response must have `past_blocks` and `future_blocks`,
  not the old sample-only `blocks` format.
- **CORS:** Origins `http://localhost:3000` and `http://127.0.0.1:3000` are allowed.
  If Next.js selects another port, copy `backend/.env.example` to `backend/.env`
  once, add that exact origin to its JSON `CORS_ORIGINS` array, and restart. CORS
  is not authentication.
- **Incorrect block positions:** First confirm the request succeeded, then check
  UTC-to-Vancouver display. Scheduling-rule issues belong to the scheduler owner.

Run from the root in PowerShell (or use the active environment's `python`):

```powershell
.\backend\.venv\Scripts\python.exe demo_week.py
.\backend\.venv\Scripts\python.exe -m unittest -v test_api test_availability
```

Tests exercise the actual FastAPI app and cover all three scenarios, validation,
UTC conversion, CORS, sleep hours, fixed-event subtraction, and preserved entries.
The original demo and availability tests are retained. Root `scheduler.py` and
`availability.py` are compatibility imports for the canonical backend modules.
The browser dashboard uses the multi-assignment `/schedule` contract documented
above; `/api/plan` retains the original single-assignment demo semantics.

Calendar files are supported in the dashboard: preview/select `.ics` commitments,
then regenerate the plan; export upcoming planned study sessions as a UTC `.ics`
snapshot. Weekly classes support bounded recurrence and cancelled/moved
occurrences. Existing data and manual event entry are preserved. See
[calendar instructions, supported formats and limits](frontend/README.md#calendar-files).

