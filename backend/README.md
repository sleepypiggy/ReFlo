# Schedule Maker Backend

Python FastAPI starter for Schedule Maker. This setup includes a health endpoint,
environment-based configuration, and CORS for the local Next.js frontend.
Scheduling logic, database storage, and authentication are not implemented yet.

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
    config.py         # Environment settings
    main.py           # API application and health endpoint
  .env.example        # Configuration template (safe to commit)
  README.md
  requirements.txt
```
