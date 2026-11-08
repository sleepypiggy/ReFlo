# Schedule Maker Backend

FastAPI backend for Schedule Maker, with multi-assignment dashboard scheduling at
`POST /schedule` and the original single-assignment `POST /api/plan`. Includes
replanning, fixed-event subtraction, sleep preferences, Pydantic request
validation, UTC responses, and configurable CORS. Database storage and
authentication are not implemented.

Dashboard scheduling tries all work in deadline order before applying shortage
priorities based on grade weight and remaining effort relative to study capacity.
Read the [policy and algorithm limitations](../frontend/API_CONTRACT.md#implemented-scheduling-rules-and-limits)
for the score, tie rules, reservation accounting, and session-packing tradeoffs.

See [API Integration](../README.md#api-integration) for the full contract and
[the frontend handoff](../docs/FRONTEND_API.md) for connection examples.

## Requirements

- Python 3.11 or newer
- pip (included with most Python installations)

## Setup on Windows (PowerShell)

Run these commands from the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

The commands use the virtual environment's Python directly, so activating the
environment or changing PowerShell's execution policy is unnecessary.
Only copy `.env.example` on initial setup; keep any existing `.env` settings.
The repository's `.gitignore` excludes `.venv` and `.env`.

## Setup on macOS / Linux

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

## Run the Development Server

From the `backend` directory, on Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

On macOS / Linux:

```bash
.venv/bin/python -m uvicorn app.main:app --reload
```

- Health check: <http://127.0.0.1:8000/health>
- Interactive API documentation: <http://127.0.0.1:8000/docs>
- OpenAPI schema: <http://127.0.0.1:8000/openapi.json>

The health endpoint returns:

```json
{"status": "ok"}
```

Use `Ctrl+C` to stop the server. `--reload` is for local development.

## Configuration and Frontend

The backend reads `backend/.env`, with environment variables taking precedence.

| Variable | Purpose | Default |
| --- | --- | --- |
| `APP_NAME` | Title in the API documentation | `Schedule Maker API` |
| `CORS_ORIGINS` | JSON array of allowed frontend origins | `http://localhost:3000`, `http://127.0.0.1:3000` |

Run the Next.js frontend in a separate terminal. It can call the backend at
`http://localhost:8000`; for example:

```typescript
const response = await fetch("http://localhost:8000/health");
const data = await response.json();
```

If the frontend uses a different port or host, add its full origin (including
the protocol and port, without a trailing slash) to `CORS_ORIGINS` and restart
the backend. CORS controls browser access; it does not provide authentication.

The configuration follows FastAPI's documentation for
[settings](https://fastapi.tiangolo.com/advanced/settings/) and
[CORS](https://fastapi.tiangolo.com/tutorial/cors/).

## Structure

```text
backend/
  app/
    __init__.py
    api.py            # Prototype single-assignment endpoint
    schedule_api.py   # Dashboard contract, shared allocation, recurrence/daily limits
    scheduler.py      # Scheduling and replanning algorithm
    availability.py   # Free-window calculation
    config.py         # Environment settings
    main.py           # API application and health endpoint
  .env.example        # Configuration template (safe to commit)
  README.md
  requirements.txt
```

## Tests

From the repository root in PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\backend\.venv\Scripts\python.exe -m unittest -v test_api test_availability test_schedule test_priorities
.\backend\.venv\Scripts\python.exe demo_week.py
```

Scheduler generated checks, the independent exhaustive reference, reproduction
commands and measured heuristic gaps are described in
[scheduler verification](../docs/SCHEDULER_VERIFICATION.md). Run
`python -m unittest -v test_scheduler_generated test_scheduler_reference` for the
focused suite, or `python -m unittest discover -v` for all Python tests.

## Optional Gemini assistant

The teammate's `POST /assistant/parse` endpoint is registered on the same FastAPI
app. Update dependencies, configure `GEMINI_API_KEY` in `backend/.env`, and restart
when using it. Scheduling does not require a key. See
[the assistant contract](../docs/ASSISTANT_API.md) for request/response examples,
error behavior, and the remaining frontend preview work. Assistant tests mock
provider responses; they do not perform live Gemini calls.
