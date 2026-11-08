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

In **Real backend**, use **Schedule assistant** to describe a fixed commitment.
It calls `POST /assistant/parse` with the current time and browser timezone. If
details are missing, answer the displayed question; the original request is kept
as context. An event draft is sent with your existing tasks, commitments,
preferences, and locked history to `POST /schedule`. Review the revised sessions
and shortage warnings, then click **Apply** to save the commitment and revised
plan together. **Discard preview**, refresh, or later edits leave the draft unsaved.
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
