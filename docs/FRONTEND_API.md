# Frontend API Handoff

The dashboard integration is now live through **`POST /schedule`**. See the
[dashboard contract](../frontend/API_CONTRACT.md) and
[example request](../examples/schedule-request.json). Run `npm run test:live`
from `frontend` to verify the real browser-to-Python flow.

The original `/api/plan` single-assignment endpoint below is retained for
prototype compatibility. The dashboard uses `/schedule` instead.

The scheduler and availability functions are integrated into **FastAPI**.

- **Planning/replanning:** `POST http://127.0.0.1:8000/api/plan`
- **Interactive docs:** <http://127.0.0.1:8000/docs>
- **Example JSON:** [examples/plan-request.json](../examples/plan-request.json)
- **Full contract and setup:** [README API section](../README.md#api-integration)

Start from the repository root in PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload
```

Each developer runs the API locally alongside Next.js. If the environment does
not exist yet, run `python -m venv backend/.venv` first.

Send this initial request with `Content-Type: application/json`:

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

Call it from Generate Plan:

```typescript
const response = await fetch("http://127.0.0.1:8000/api/plan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const plan = await response.json();
if (!response.ok) throw new Error(plan.error ?? "Planning failed");
// Replace this assignment's calendar entries with:
const blocks = [...plan.past_blocks, ...plan.future_blocks];
```

The initial response has **four one-hour study blocks** (two Tuesday, two
Wednesday), `future_scheduled_minutes: 240`, and `unscheduled_minutes: 0`.
Each block contains `title`, `start`, and `end`, ready to map to calendar events.
Keep the assignment ID in UI state when replacing its entries; this initial API
accepts one assignment per request and uses its title rather than a task ID.

All response timestamps use UTC `Z`. Render in **America/Vancouver** with the
calendar's named-timezone support. Keep the offsets in input timestamps; minute
precision is required (seconds `00`, no fractions). The fixture's dates are
intentionally fixed for the demo rather than taken from the current clock.

For **I didn't finish**, send all previous blocks as `existing_blocks`, change
`remaining_minutes` to 180 and `now` to `2026-11-10T20:00:00-07:00`:
Tuesday's entries are preserved, with 180 future minutes Wednesday/Thursday.
Remove Thursday's window to get 120 scheduled / 60 unscheduled. Alternatively,
use the optional `availability` object documented in the README to supply fixed
events, timezone, wake-up, and bedtime; Python filters the windows before planning.

Validation errors return **400** with `error` and field-level `details`.
Non-JSON content types return **415**. CORS defaults allow
`http://localhost:3000` and `http://127.0.0.1:3000`; extra origins go in
`backend/.env` as a JSON `CORS_ORIGINS` array, followed by a server restart.

Verified API scenarios: **240/0**, **180/0**, and **120/60** scheduled/unscheduled
minutes. The frontend button and calendar wiring remain with the frontend owner.
