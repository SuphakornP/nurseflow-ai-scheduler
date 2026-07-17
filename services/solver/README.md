# NurseFlow solver service

FastAPI service for deterministic ICU nurse scheduling. OR-Tools CP-SAT creates
the roster; a separate Python validator verifies every hard rule before export.

The service uses nickname-only demo data and does not require an OpenAI key.

## Run locally

```bash
cd services/solver
cp .env.example .env.local
# Set SOLVER_API_TOKEN to the same random 32+ character value used by Next.js.
uv sync --extra dev
uv run python -m uvicorn app.main:app --reload --port 8000 --env-file .env.local
```

Interactive API documentation and the OpenAPI schema are disabled because the
solver is an internal service. Use the endpoint contract below when testing it.

## Endpoints

- `GET /health` remains public and returns a minimal service status.
- `GET /demo` requires `Authorization: Bearer <SOLVER_API_TOKEN>` and returns
  deterministic 28-nurse August 2026 input. Pass
  `optimization_profile=balanced`, `requests_first`, or `minimize_l0` to prepare
  the three showcase candidates.
- `POST /generate` requires the same bearer token, accepts a `ScheduleProblem`,
  and returns assignments, metrics, optimization phases, summaries, coverage,
  and independent validation.
- `POST /export` requires the same bearer token and accepts
  `{ "problem": ..., "assignments": [...] }`. If
  assignments are omitted it generates a schedule first. Invalid schedules are
  rejected with HTTP 409.

For an imported roster, Next.js may also include a sanitized
`source_workbook_template`. The solver rechecks ZIP expansion, active parts,
worksheet dimensions, roster rows, dates, and assignment completeness, then
writes only the monthly result cells while preserving source styles. Summary,
Validation, Unfulfilled Requests, and Metadata sheets are regenerated from the
validated schedule.

Each `DailyRequest` has an explicit `constraint_mode`:

- Use `PREFERENCE` for requested `D`, `N`, `O1` through `O4`, and Member L0
  Education. An unmet preference remains visible without invalidating safety.
- Use `REQUIRED` for `O/D` and `O/N`; the solver may choose either listed value
  but may never leave that domain.
- Use `LOCKED` for approved Vacation and ordinary-staff Education. These values
  are immutable and may make the problem infeasible when they conflict with a
  hard safety rule.

If fixed VAC/ED events leave a skill group below its combined Day + Night
minimum, an infeasible response includes a `MANDATORY_SKILL_CAPACITY` failure
with date, available count, required count, and aggregate fixed-event counts. It
never includes employee identifiers. The application shows this evidence while
keeping Confirm and Export blocked.

On weekdays, Member L0 receives Education whenever not assigned Day or Night;
an explicit O1 through O4 request may still produce OFF. Member L0 remains
limited to seven clinical shifts in the period. A contiguous requested OFF/VAC
block longer than four days may lose at most one requested OFF and never VAC.

Optimization freezes the shared business priorities in this order: O1, O2, O3,
O4, remaining preferences, OFF/VAC adjacency, Day/Night fairness, minimum
Member L0 clinical use, and weekend fairness. Candidate profiles only break ties
after those values are fixed.

## Test

```bash
uv run pytest
```

See [ASSUMPTIONS.md](ASSUMPTIONS.md) for decisions made where the source business
rules are ambiguous.
