# ReFlo

## Description

An AI scheduler app that imports your schedule, activities, and assignments and automatically updates your schedule to help you manage your time throughout the week.

## Pitch

Balancing work and social life is hard for students, and the transition from having a mostly fixed schedule in high school to having much more freedom makes it hard to manage your time. Our app helps you manage your time productively while allowing you to enjoy your personal time.

## Key Goals

- Import your schedule for each week and plan work times for your tasks.
- Allow you to update your schedule by adding or canceling activities.
- Include an **“I didn’t finish” / “I skipped”** feature that updates your schedule to give you more time to finish.
- Ask you which tasks to prioritize if there is a shortage of time.
- Allow you to estimate how much time you need to work, while also providing its own estimate.
- Include a sleep cutoff that allows you to set your wake-up time and bedtime.
- Allow you to set maximum study session lengths, preferred break durations, and maximum work or study time per day.

## Refined Key Goals

1. **Build a weekly study plan around fixed commitments.** Let students add classes, work shifts, meals, and other activities, then enter their assignments, deadlines, and estimated work time. Schedule study blocks in the available time before each deadline.
2. **Keep the plan up to date as activities change.** Let students add, edit, or cancel activities and update the affected study blocks.
3. **Replan unfinished work.** Let students select **“I didn’t finish”** and enter how much work remains. Reallocate upcoming study time, preserve past calendar entries, and show what changed.
4. **Respect sleep and study preferences.** Let students set their wake-up time, bedtime, maximum study session length, and break duration. Use those preferences when generating and updating the plan.
5. **Show when work does not fit.** Display the scheduled and unscheduled time for each assignment so students can see how much work still needs a slot before the deadline.

## Stretch Goal

**Suggest editable time estimates.** When students are unsure how long an assignment will take, offer a suggested range based on the task type or their past estimates for similar work. Let students adjust the estimate before generating the plan.

## Team Members

- [Randy Du](https://github.com/sleepypiggy)
- [George Li](https://github.com/vermoshrank)
- [Edward Lau](https://github.com/lauedward82-cloud)
- [Kevin Li](https://github.com/Kevin968k)

## Current Planning Improvements

The prototype uses feasibility-first scheduling with weighted deadline pressure, a saved
plan-update indicator, replanning summaries with undo, and an **I Skipped** action.
The dashboard separates remaining, upcoming and unscheduled time. JSON backup and
restore work for both demo and real workspaces, with validation and confirmation.
See [the frontend guide](frontend/README.md#planning-controls-and-backups) for details.
Automated project checks are defined in `.github/workflows/checks.yml`.
Seeded scheduler invariants and a bounded independent exhaustive solver measure
constraint correctness and heuristic gaps; see
[scheduler verification](docs/SCHEDULER_VERIFICATION.md) for commands and results.

Study sessions that cannot be dragged show a lock icon. Hover over the block or
open it (click, Enter or Space) to see the specific reason: past time, already
started, locked, completed, unfinished or skipped history. Move failures explain
deadline, sleep, fixed-event, break and daily-limit conflicts without changing
the saved plan. Indicators refresh as sessions reach their start time.

Short calendar blocks use compact, truncated titles and small status icons so
text stays within its block. Time ranges remain visible whenever a time row and
title row fit; only the smallest blocks hide the time row. Taller blocks also
retain topic labels. Hover
for full details or open a block to view its complete title and times. This
changes the display only; event and study durations are preserved.

Very short entries have a small minimum display height so a complete title line
can fit. Their actual start/end times stay unchanged, and visually crowded blocks
are arranged side by side rather than covering each other.

## Quick start

Use Node.js 22 and Python 3.11 (the versions used in CI).

### 1. Start the dashboard

```sh
cd frontend
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). **Demo mode** works without a backend.

### 2. Start the scheduler

In a separate terminal, from the repository root:

**Windows PowerShell**

```powershell
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

**macOS / Linux**

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
```

### 3. Build your plan

1. Switch **Data source** to **Real backend**.
2. Add fixed commitments and assignments with deadlines and estimated work time.
3. Set your sleep and study preferences, then click **Generate Schedule**.
4. Mark sessions complete, unfinished, or skipped as you go.

Demo and real workspaces are saved separately in your browser. Export a JSON backup to keep a copy.

To enable **Flo**, copy `backend/.env.example` to `backend/.env`, set `GEMINI_API_KEY`, and restart the backend. Scheduling works without a key.

## Development

Backend tests, from the repository root using the virtual environment's Python:

```sh
python -m unittest discover -v
```

Frontend checks, from `frontend`:

```sh
npm test
npm run lint
npm run build
```

See the [frontend guide](frontend/README.md) for browser tests, calendar support, and backup details.

## API and docs

- [Interactive API docs](http://127.0.0.1:8000/docs) — available while the backend runs.
- [Dashboard API contract](frontend/API_CONTRACT.md) — `POST /schedule` and scheduling rules.
- [Assistant setup and contract](docs/ASSISTANT_API.md) — optional Gemini integration.
- [Scheduler verification](docs/SCHEDULER_VERIFICATION.md) — correctness checks and tradeoffs.
- [Legacy planning API](docs/FRONTEND_API.md) — single-assignment `POST /api/plan`.
