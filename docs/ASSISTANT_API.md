# Gemini event draft API

The teammate's Gemini branch is integrated into the existing FastAPI application.
`POST /assistant/parse` returns a fixed-event draft or a clarification question.
It does not save events, call the scheduler, or apply calendar changes.

## Setup

Update the Python dependencies from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
```

Set `GEMINI_API_KEY` in `backend/.env` or the backend process environment, then
restart the API using the existing startup command. Keep the real key out of
Git and frontend environment files. The configured model is
`gemini-3.5-flash-lite`. `/health` and `/schedule` work without an API key;
assistant requests return 503 when the key is missing.

## Contract

Send JSON to `http://127.0.0.1:8000/assistant/parse`:

```json
{
  "message": "I have work from 7 to 8 tonight",
  "current_time": "2026-11-10T18:00:00-08:00",
  "timezone": "America/Los_Angeles"
}
```

The fixed date is for reproducible examples. Normal callers supply their current
timestamp and IANA timezone. A draft response has top-level event fields:

```json
{
  "type": "event_draft",
  "title": "Work shift",
  "start": "2026-11-10T19:00:00-08:00",
  "end": "2026-11-10T20:00:00-08:00"
}
```

For missing or ambiguous hours, the alternative response is:

```json
{
  "type": "clarification",
  "question": "What time does your shift start and end?"
}
```

Request validation errors return 400, incorrect content types 415, provider or
configuration failures 503, and invalid model output 502. Responses use the same
`error` format as the scheduling endpoints. Provider exception details and API
keys are not returned to the browser.

## Verification and next integration step

`python -m unittest discover -v` from the repository root includes assistant
contract tests with mocked Gemini responses. These validate drafts, questions,
provider failures, missing keys and output validation without external calls.
Live Gemini model responses have not been verified by those tests.

The scheduling preview regression uses a hand-written event draft, checks the
revised plan and shortages, and verifies that unfinished history stays intact.
The dashboard does not yet provide an assistant input or Apply/Cancel preview:
that frontend flow remains separate from this endpoint integration. Its intended
sequence is parse, clarify if needed, call `/schedule` with the candidate event,
preview, then apply only after student confirmation.
