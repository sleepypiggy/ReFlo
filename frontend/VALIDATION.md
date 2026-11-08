# Frontend implementation validation

Current integrated application checks:

- Python API, availability and dashboard scheduling: **116 tests passed**.
- Frontend calendar, task, topic, plan-accounting and backup validation: **86 tests passed**.
- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm run build`: passed; production page prerendered successfully.
- `npm run test:e2e`: **24 passed** in Microsoft Edge against the production build.
- `npm run test:live`: **7 passed** using separate browser and real FastAPI servers.
- Git whitespace validation and workflow YAML parsing: passed.
- GitHub-hosted workflow execution is pending its first push; local equivalents pass.

Calendar coverage includes single/weekly imports, COUNT/UNTIL, EXDATE, cancelled
and moved occurrences, both DST transitions, embedded timezone consistency,
unknown/ambiguous/nonexistent timezone errors, malformed/unsupported features,
size/expansion limits, repeated-import identities, backup revival, API UTC
serialization and overlap rejection, valid UTC exports, and exact time round trips.
The browser verifies preview, selection, confirmation, repeated imports, refresh,
mobile preview width, downloads and export re-import. The live calendar test
checks that actual Python scheduling reserves imported lecture times before export.
The focused two-test calendar browser suite also passes after the final build.

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

Automatic commitment replanning is verified for manual event creation and edits,
weekly occurrence conflict detection, and imported calendar commitments. Live
browser checks keep the selected event times unchanged while study sessions
move. A network-failure regression preserves the saved event, assignments and
study history across refresh, then verifies successful manual retry. Boundary
touching and preserved historical/locked entries do not trigger automatic moves.

Drag-and-drop integration keeps fixed events authoritative: moving a commitment
onto a future manually placed study session releases only the conflicting pin
and replans automatically. Other pins and locked history remain intact. A browser
regression verifies the outgoing reservations, fixed event time and revised study
block; existing recurring occurrence movement and manual study placement tests pass.

Schedule-change review shows previous/new slots, additions, removals and remaining
shortages after real generation or assistant Apply. Calendar outlines and Updated
labels mark changed blocks; dismissing clears highlights without removing undo.
A browser regression checks mobile width, visual review, dismissal, and undo while
retaining the saved event, task values and historical entries. Unit tests cover
split blocks, regenerated IDs and separation between assignments.

Integrated assistant impact previews share slot comparisons with the applied
change review. Preview shows separate removed/added slots and affected assignment
minutes without saving; Apply clears the stale-plan flag and then shows the
review and calendar highlights. Live coverage includes a partial fit (15 minutes
scheduled and 15 unscheduled), discard without changes, Apply and persistence.
Next.js route type generation was also verified before the TypeScript check,
matching the updated CI workflow.

Drag-lock explanations use the same reason function as move eligibility and
rejection. Calendar blocks show a lock with a hover explanation and accessible
text; the session dialog exposes the reason on keyboard and mobile. Browser
coverage verifies past/started/locked reasons and automatic updates when a future
session starts. Unit coverage also includes finalized statuses, exact boundaries,
and draggable manual placements. The mobile dialog was visually checked.

Compact calendar layout uses actual block height to hide extra labels, truncate
titles and retain small lock/update icons. All event content clips to its block;
full names and time ranges remain in tooltips, accessible labels and dialogs.
Browser coverage checks adjacent 10/15-minute commitments and study, clipping
bounds, unchanged relative heights, week/day/month views and mobile width.
Desktop and mobile screenshots were visually reviewed.

The compact-block regression also verifies that one-hour study sessions retain
their visible time range and title in both week and day views, with both rows
contained inside the block. Only blocks too short for two rows hide the time.

Study and fixed-event typography is checked for matching padding, title font
size/weight/line height, time font size/line height, and time-to-title spacing,
including a one-hour study block beside a taller fixed event.

Topic rows have an explicit line height and appear only when the whole line fits.
The regression covers a 75-minute event at the intermediate height, a taller
event, and a shorter assignment with the complete topic retained in its tooltip.
Update text yields to the topic row and uses its inline icon in smaller blocks.

## Goal 1 + Goal 2 branch integration (2026-11-08)

Synced the conversational assignment/event draft work with `main` at `30a3511`.
The resolved assistant panel retains persistent chat, missing-field questions,
validated drafts, stale/duplicate protections, and Goal 2's separate removed/added
study slots and affected-assignment totals. Both creation kinds use the shared
impact preview; new assignment names resolve against the candidate plan. Undoing
an assistant replan retains newly created assignments as well as fixed events.

Verified locally after resolving the merge:

- 83 frontend unit tests; lint; generated Next.js types; TypeScript check.
- 110 Python tests and all three `demo_week.py` scheduling scenarios.
- Production build using the ignored `.next-live-tests` output directory.
- 20 browser regression cases against that production build in Chrome.
- 7 live-backend browser cases, including fixed-event displacement/partial fit,
  preview-only changes before Apply, discard, persistence, and plan review.

The chat browser cases stub assistant responses. Backend chat tests mock Gemini
extraction while exercising the real route and scheduler. Live Gemini model
responses have not been verified. No credentials were used by these tests.

Merged Goal 1 with `main` at `79533ff`, retaining the drag-lock explanations.
Validation of the combined tree passed: 114 backend tests, three scheduling
scenarios, 84 frontend unit tests, lint, generated route types, TypeScript,
production build, 21 browser regression cases, and seven live-backend cases.
Separate teammate testing in Real backend mode confirmed clarification for
missing study time and grade weight, preservation of the 10 PM deadline, and
saving 30 minutes and 10% after Apply without the one-hour offset.

Very short event clipping was reproduced with a one-minute event whose title
line extended below the block. A 22px minimum display height and conservative
whole-line cutoffs now cover 1/5/10/15/20/25/45/65/80-minute events in week and day
views. Adjacent visually crowded event/study blocks must not cover each other.
Only display geometry changes; actual timestamps remain unchanged. Desktop and
mobile screenshots were visually reviewed after the fix.
