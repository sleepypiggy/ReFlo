# Schedule Maker frontend

Next.js dashboard for assignment planning, fixed commitments, and study progress.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Demo mode works without Python. Switch **Data source**
to **Real backend** for your own workspace. Each mode persists independently in
browser localStorage. Preferences are saved per workspace. Browser dates are local.

The calendar supports month/week/day views, Today, and previous/next navigation. Click
commitments to edit/delete; click study sessions to complete or report unfinished
work. Assignment deletion also removes its sessions after a confirmation. Updating
inputs does not automatically regenerate the plan; use Generate Schedule.

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
shift causing a shortage, UTC/Vancouver rendering, and persistence after refresh.
The backend virtual environment and dependencies must already be installed.
The test uses Microsoft Edge by default and closes both test servers afterward.

## Planning controls and backups

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

The backend now includes `/assistant/parse`, but an assistant input and a proposed
schedule preview with Apply/Cancel are not yet part of this dashboard. See
[assistant setup](../docs/ASSISTANT_API.md).
