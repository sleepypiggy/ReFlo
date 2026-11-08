# Schedule Maker frontend

Next.js dashboard for assignment planning, fixed commitments, and study progress.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Demo mode works without Python. Switch **Data source**
to **Real backend** for your own workspace. Each mode persists independently in
browser localStorage. Preferences are saved per workspace. Browser dates are local.

The calendar supports week/day views, Today, and previous/next navigation. Click
commitments to edit/delete; click study sessions to complete or report unfinished
work. Assignment deletion also removes its sessions after a confirmation. Updating
inputs does not automatically regenerate the plan; use Generate Schedule.

Backend setup and JSON examples: [API_CONTRACT.md](API_CONTRACT.md).
Validation results and design-check limitations: [VALIDATION.md](VALIDATION.md).
The existing `/health` endpoint can be checked from the footer. The Python teammate
must implement `/schedule` before real generation/rescheduling works end to end.

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
