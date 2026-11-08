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

## Legacy endpoint verification

`python -m unittest discover -v` from the repository root includes assistant
contract tests with mocked Gemini responses. These validate drafts, questions,
provider failures, missing keys and output validation without external calls.
Live Gemini model responses have not been verified by those tests.

The scheduling preview regression uses a hand-written event draft, checks the
revised plan and shortages, and verifies that unfinished history stays intact.
The current dashboard uses the conversational endpoint below and retains the
same preview-before-apply boundary.

## Conversational drafts: `POST /assistant/chat`

The dashboard now uses this endpoint for **creating assignments and single fixed
events**. Editing/deleting existing items and recurring-event chat actions are
not part of this first milestone. The legacy `/assistant/parse` contract above
remains unchanged.

A request includes role-based `messages`, `current_time`, `timezone`, and either
`draft: null` or the pending draft returned by the previous response. Messages
must end with a user turn; at most 40 messages and 24000 total content characters
are accepted. The browser leaves room for a response and offers Start over at
the limit. No system role is accepted from the browser.

```json
{
  "messages": [
    {"role": "user", "content": "Add Integration worksheet due Tuesday at 5pm; two hours."}
  ],
  "draft": null,
  "current_time": "2026-11-08T18:00:00Z",
  "timezone": "America/Vancouver"
}
```

Responses have `status` (`needs_input`, `ready`, or `cancelled`), an assistant
`message`, a nullable `draft`, and `missing_fields`. A draft contains a stable UUID,
`started_at` message index, `kind` (`assignment`/`event`/null), nullable `title`,
`deadline`, `estimated_minutes`, `grade_weight`, `start`, and `end`, plus `sources`
mapping supplied fields to their user-message indexes. Send it back unchanged
alongside the full conversation and the next user reply.

Assignment requirements: nonblank name (up to 150 characters), deadline date AND
time with an explicit timezone offset, whole-minute estimate from 1 to 60000,
and grade weight from 0 to 100. Missing weight is **null**, never a default. An
explicit 0% is accepted. Event requirements: name, start and end instants at least
one minute apart. All relevant dates must fit the scheduler's 366-day future
horizon. Time shortages are scheduler warnings rather than invented availability.

Gemini returns only allowlisted field updates with exact quoted user evidence and
its message index. Application code verifies the quote and role, checks numeric
values against their evidence, and does not accept a date-only quote as a supplied
clock time. Older evidence cannot overwrite a later correction. The backend
computes required-field questions and applies the existing scheduler input schemas
before reporting readiness. Structured output and evidence checks reduce invented
fields; they cannot guarantee flawless natural-language interpretation. The user
must review the resulting draft and plan before Apply.

The endpoint never schedules or writes anything. On readiness, the frontend builds
an unsaved candidate with stable item ID `assistant-<draft UUID>` and calls
`/schedule`. Only Apply commits both item and successful scheduling result. Fixed
commitments and preserved study history remain in the candidate. Conflicting future
manual placements yield to newly proposed events. Shortages remain visible.

Messages and partial draft persist under `schedule-maker-chat:backend:v1`, separately
from workspace data. Previews are memory-only and invalidated by schedule edits,
refresh, or typing a correction. Duplicate item IDs and repeated Apply are rejected.
Provider or scheduling failures keep the calendar unchanged and offer retries;
retrying scheduling reuses the draft without a second model request.

Tests in `test_assistant_chat.py` mock Gemini extraction while exercising the real
FastAPI route, validation, missing-field questions, corrections, cancellation,
provider failures, and SDK schema configuration. `assistantChat.test.ts` checks
frontend validation, candidate construction, duplicate detection, and persistence.
Browser cases in `assistant.spec.ts` cover the complete UI lifecycle with mocked
network responses. Live Gemini responses require a configured key and have not
been exercised as part of these automated tests.

### Combined impact preview

Both assignment and event chat drafts now use the same slot comparison as fixed
event previews. The preview lists **Removed study slots**, **Added study slots**,
and **Affected assignments**, with scheduled and unscheduled minutes. It does not
assume one removed slot maps to one added slot: sessions may split or shorten.
The comparison uses the preview's captured time, and newly created assignment
names come from the candidate plan. Apply remains explicit and invalidates after
intervening edits. Undo of an applied replan keeps the newly saved assignment or
fixed commitment while restoring the previous study calendar for regeneration.
