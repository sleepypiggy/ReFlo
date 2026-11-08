# Frontend implementation validation

Current integrated application checks:

- Python API, availability and dashboard scheduling: **90 tests passed**.
- Frontend task, plan-accounting and backup validation: **31 tests passed**.
- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm run build`: passed; production page prerendered successfully.
- `npm run test:e2e`: **9 passed** in Microsoft Edge against the production build.
- `npm run test:live`: **5 passed** using separate browser and real FastAPI servers.
- Git whitespace validation and workflow YAML parsing: passed.
- GitHub-hosted workflow execution is pending its first push; local equivalents pass.

Assistant endpoint tests use mocked Gemini responses; no live model calls were
made. Light/dark theme switching, persistence, storage failure handling and
responsive layouts are verified together with the retained planning controls.

New coverage includes feasibility-first weighted-pressure allocation, deterministic
IDs, assistant work-shift preview scenarios, persisted plan-update state, summaries that ignore regenerated IDs,
calendar undo that retains progress, skipped sessions with no completion credit,
skip retry after network failure, future-only totals, valid/invalid backups,
restore confirmation/cancellation, and footer backup controls on mobile.

Browser coverage includes assignment creation/edit/deletion, hour-to-minute conversion,
fixed-event validation/recurrence/edit/deletion, all preferences, persistence after
refresh, completion without duplicate credit, unfinished history preservation,
backend request serialization, valid response replacement, malformed-response/404/
network failure preservation, saved unfinished work after failed rescheduling, retry,
independent demo/real workspaces, month/week/day navigation, and no page overflow at
1440, 1024, 768, 390, and 320 pixels.

The original regression tests use intercepted scheduling fixtures. The integration
now implements `/schedule` and adds `npm run test:live`, which exercises the real
Python server through the browser. It verifies 240/0, 180/0 and 120/60 minute
scenarios, preserved history and refresh persistence. See
[API_CONTRACT.md](API_CONTRACT.md) for the implemented contract.

Desktop and mobile screenshots were visually reviewed. The bundled design skill's
marketing-page gate did not pass: its first run reported 69 findings, including
requirements for a full-screen hero, pictures, animation moments, marketing calls
to action, and layout heuristics that treat calendar sessions as ordinary buttons.
Its separate layout checker could not find Chrome. Applicable text-contrast and
mobile touch-target findings were subsequently improved. This dashboard follows the
requested application layout; no marketing gate or full accessibility certification
is claimed. Raw gate reports and screenshots remain in ignored local output folders.

## Assignment spacing verification

The default-on spacing preference is tested against real Python: four hours over
four open days produce one-hour daily sessions; disabling and re-enabling the
preference restores earliest placement and then the same stable spaced plan.
Unit tests cover per-assignment daily sharing, larger same-day gaps, busy days,
tight-deadline fallback, unchanged shortage allocation, deterministic IDs, local
days across DST and avoiding minute-long fragments over long horizons.
The original packed-demo regression fixtures explicitly disable spacing.

API error handling now includes field-level backend validation details. A regression
simulates an old server rejecting `preferences.spread_assignments`, verifies the
restart hint, and confirms that existing study sessions are preserved. The local
port-8000 server was restarted and a real spacing request returned HTTP 200.

Morning/afternoon/evening placement is verified with real browser requests: three
sessions at 09:00, 12:00 and 17:00, then an added lunch meeting that moves the noon
session to 13:00 without shortages. Python regressions cover blocked dayparts,
deadline fallback, rotating single daily sessions, shared assignments, local-time
periods across UTC date changes, and preserved locked history.

Minimum session regressions verify 15-minute dashboard blocks, uneven 60 + 45
and redistributed short tails, small gap avoidance, daily balancing, and honest
shortage reporting when a valid minimum block cannot fit. The priority oracle
uses 15-minute slots to reflect the new scheduling constraint.
