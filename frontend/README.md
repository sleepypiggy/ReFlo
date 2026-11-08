# ReFlo frontend

Next.js dashboard for assignment planning, fixed commitments, and study progress.

```sh
npx --yes pnpm install --frozen-lockfile
npm run dev
```

Open http://localhost:3000. Demo mode works without Python. Switch **Data source**
to **Real backend** for your own workspace. Each mode persists independently in
browser localStorage. Preferences are saved per workspace. Browser dates are local.

The calendar supports month/week/day views, Today, and previous/next navigation. Click
commitments to edit/delete; click study sessions to complete or report unfinished
work. Assignment deletion also removes its sessions after a confirmation. Updating
inputs does not automatically regenerate the plan; use Generate Schedule.

In **Real backend**, use **Flo** to create an assignment or a single
fixed event through chat. `POST /assistant/chat` receives role-based history, the
pending draft, the current time, and browser timezone. The backend asks for all
missing/invalid fields together; an assignment always needs a name, deadline date
and time, positive work estimate, and an explicit grade weight (0–100%). No weight
is assumed. Replies update the same draft, including corrections.

Conversation and draft fields persist separately in browser storage. Schedule
previews never persist. Complete drafts call `/schedule` with the existing tasks,
commitments, preferences, and protected history. Review the revised sessions and
shortages, then click **Apply** to save the item and revised plan together.
**Cancel draft**, **Start over**, and **Discard preview** do not change the calendar.
Intervening edits invalidate the preview. Refresh restores the conversation but
requires a fresh preview before Apply. **Retry message** retries a failed model
request; **Preview changes** retries scheduling without asking the model again.
The assistant requires `GEMINI_API_KEY` in `backend/.env` (see
`backend/.env.example`); demo mode remains independent of the assistant.

Backend setup and JSON examples: [API_CONTRACT.md](API_CONTRACT.md).
Validation results and design-check limitations: [VALIDATION.md](VALIDATION.md).
The `/health` endpoint can be checked from the footer. FastAPI now implements
`POST /schedule`; Real backend mode generates and replans actual Python study
blocks, including shared availability, sleep, commitments, and daily limits.

```sh
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Browser tests use installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL` to
another installed channel (e.g. `chrome`), or use `chromium` after installing the
Playwright browser. Tests start a production server on port 3100 unless one is
already running there. Run the production build before browser tests.

`src/datatypes.ts` preserves the original Task, Event, Preferences and Schedule
models. Independent StudyBlocks reference tasks; task start/end metadata is not
used to place work. `src/lib/apiAdapter.ts` owns snake_case and ISO serialization.
FullCalendar v7 includes timeGrid and classic theme plugins within its React package.

The existing design skill informed spacing, typography, keyboard access, and visual
consistency. Dashboard requirements take priority over its marketing hero/animation
recipes. No authentication, database, drag-and-drop, or frontend scheduler is used.

## Live backend verification

From this directory, run `npm run test:live`. This starts isolated FastAPI (8100)
and Next.js development (3101) servers and uses real browser HTTP requests, with
no mocked scheduling responses. It verifies generation, unfinished work, a fixed
shift causing a shortage through assistant preview/Apply, UTC/Vancouver rendering,
and persistence after refresh. The assistant model response is stubbed in this
test; scheduling uses the real backend. The regular browser suite also covers
clarification, discard, stale previews, malformed drafts, and API failures.
The backend virtual environment and dependencies must already be installed.
The test uses Microsoft Edge by default and closes both test servers afterward.

## Calendar files

Use **Import calendar (.ics)** below the timetable. Choose a file, review every
occurrence's title, dates, source timezone and UTC instants, deselect anything you
do not want, then confirm. Warnings identify rejected events/series; nothing is
saved until confirmation. Imported occurrences reserve time as fixed commitments.
**Generate Schedule** afterward; demo mode only replays sample sessions.

Supported input is iCalendar 2.0 with UID, SUMMARY, DTSTART and DTEND. Timed
single events and weekly RRULE classes support INTERVAL, plain BYDAY, WKST, and
exactly one COUNT or UTC UNTIL. EXDATE and RECURRENCE-ID overrides support cancelled
and moved classes. A malformed/unsupported series is rejected completely, while
independent supported events remain selectable. Cancelled occurrences are omitted.

Times must use UTC or an IANA TZID. IANA VTIMEZONE definitions are accepted when
their offsets agree with the runtime's timezone database at the imported instants.
Unknown/custom timezone names, conflicting embedded timezone rules, floating times,
ambiguous/nonexistent DST wall times, all-day dates, DURATION, RDATE, EXRULE,
non-weekly/unbounded recurrence and RANGE=THISANDFUTURE are rejected with an
explanation. Export UTC instants when timezone definitions disagree. Reminders and
non-event components are not imported. Limits: 1 MB per file, 1000 source
components, 1000 expanded occurrences/workspace commitments, and 366 days per
recurring series. Shorten/split long calendars rather than importing a truncated term.

Repeated import matches UID plus original occurrence instant (RECURRENCE-ID for
moved classes), independent of filename/title. Existing occurrences are skipped,
including manually edited ones. Files do not update or delete existing commitments;
remove an old occurrence explicitly before importing a replacement. Manual event
entry and existing saved workspaces/JSON backups continue to work.

**Export study calendar** downloads upcoming/in-progress planned sessions with
assignment titles and UTC start/end instants. Completed, unfinished, skipped and
elapsed history are excluded. Session IDs produce stable calendar UIDs. The button
is disabled when no sessions qualify. Regenerate a stale plan before exporting it.
Downloading and importing a file creates a **snapshot**, not ongoing calendar
synchronization. There are no account connections, OAuth or calendar uploads;
calendar parsing runs locally in the browser.

`ical.js` handles parsing, weekly iteration and serialization; `temporal-polyfill`
validates local times and converts each occurrence using timezone rules. Both are
installed with frontend dependencies; no additional backend dependency is needed.
Run `npm test`, lint, typecheck, build, and `npm run test:e2e`. The browser calendar
tests cover preview/selection/confirmation, duplicate imports, refresh, invalid
files, downloads and re-importing exported instants. `npm run test:live -- --grep
"calendar import"` verifies imported commitments against the real Python scheduler.

## Planning controls and backups

- Maximum session length must be at least 15 minutes, matching `/schedule`.
  Smaller remaining work stays valid and is shown as unscheduled with an
  explanation; estimates are never rounded up. Older saved workspaces and JSON
  backups with smaller positive session limits are normalized to 15 without
  losing data, and affected plans are marked for regeneration.
- Scheduling first tries to fit all work in deadline order. If it cannot, the
  teammate's policy ranks work by grade weight multiplied by remaining work
  relative to available study capacity. There is no manual priority override.
- The saved **Plan needs updating** badge remains after changing inputs until real
  backend generation succeeds. Demo mode continues to use authored sample data.
- Generation shows moved, added and removed future sessions and unscheduled minutes.
  **Undo last replan** restores the previous calendar while keeping task edits and
  progress reports. It is one level and does not survive refresh.
- **I Skipped** retains session history and remaining work, then replans. Failed
  replanning preserves the report so Generate Schedule can retry.
- Totals distinguish remaining work, upcoming planned time and unscheduled work.
- **Export backup** and **Import backup** are in the footer on desktop and mobile.
  Restore previews assignment counts and asks before replacing both workspaces.
  Invalid files are rejected; import marks plans as needing regeneration.

Pull requests and pushes to main run `.github/workflows/checks.yml`: Python tests,
frontend unit tests, lint, TypeScript, build, browser regressions, and live Python
integration. The workflow uses Chromium on Linux; local browser tests default to
Microsoft Edge. GitHub-hosted execution occurs after the workflow is pushed.

## Updated dashboard and theme

Calendar and Assignments are separate navigation pages. Use Assignments for the
remaining/upcoming/unscheduled totals and task editing; the calendar remains wide
for month/week/day views. The sidebar theme toggle supports light/dark modes and
remembers the selection separately from schedule data. Backup controls remain in
the footer in both themes and on mobile.

The dashboard includes conversational assignment/event drafts and an Apply/Cancel
preview. `/assistant/parse` remains available for older event-only clients. See
[assistant setup and chat contract](../docs/ASSISTANT_API.md).

## Spread assignment work

In **Preferences**, **Spread study sessions across days** is enabled by default.
After saving, use **Generate Schedule** in Real backend mode to update existing
blocks. Work is balanced across available days and sessions are separated more
when time allows. If a deadline is tight, the scheduler keeps the work scheduled
with the normal minimum breaks. Disable the preference to fill the earliest slots.
Demo mode still replays authored sample sessions.

## A 400 after updating the backend

If validation mentions `preferences.spread_assignments` and "Extra inputs are not
permitted", an old Python server is still running. Stop the backend terminal with
Ctrl+C, then start a single current instance from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --reload-dir backend/app --port 8000
```

Keep only one backend instance on port 8000. Refresh the dashboard and generate
again. API errors now include the rejected field and the backend's explanation;
failed generation preserves the existing calendar.

With spacing enabled, sessions also prefer a mix of morning, afternoon and evening
slots, rather than repeatedly starting in the morning. Only conflict-free waking
time before the deadline is used. If a period is unavailable, the scheduler uses
another period or keeps the existing feasible placement. Save preferences and
click Generate Schedule to update your calendar.
