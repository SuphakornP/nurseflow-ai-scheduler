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

## Test

```bash
uv run pytest
```

See [ASSUMPTIONS.md](ASSUMPTIONS.md) for decisions made where the source business
rules are ambiguous.
