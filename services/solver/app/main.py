from __future__ import annotations

import re
from io import BytesIO

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from .auth import require_solver_token
from .demo import build_demo_problem
from .export import build_workbook
from .models import (
    ExportRequest,
    GenerateResponse,
    OptimizationProfile,
    ScheduleProblem,
)
from .solver import InputProblemError, generate_schedule, summarize_assignments
from .validation import validate_schedule


app = FastAPI(
    title="NurseFlow Solver Service",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    description=(
        "Deterministic ICU nurse scheduling with OR-Tools CP-SAT, "
        "independent validation, and Excel export."
    ),
)

protected_router = APIRouter(dependencies=[Depends(require_solver_token)])


def _export_filename(period_name: str) -> str:
    stem = re.sub(r"[^a-z0-9_-]+", "-", period_name.casefold()).strip("-_")
    return f"nurseflow-{(stem or 'schedule')[:80]}.xlsx"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@protected_router.get("/demo", response_model=ScheduleProblem)
def demo(
    optimization_profile: OptimizationProfile = OptimizationProfile.BALANCED,
) -> ScheduleProblem:
    """Return deterministic, nickname-only input for the August 2026 showcase."""

    return build_demo_problem(optimization_profile)


@protected_router.post("/generate", response_model=GenerateResponse)
def generate(problem: ScheduleProblem) -> GenerateResponse:
    try:
        return generate_schedule(problem)
    except InputProblemError as exc:
        raise HTTPException(status_code=422, detail={"errors": exc.errors}) from exc


@protected_router.post("/export")
def export(payload: ExportRequest) -> StreamingResponse:
    if payload.assignments is None:
        try:
            result = generate_schedule(payload.problem)
        except InputProblemError as exc:
            raise HTTPException(status_code=422, detail={"errors": exc.errors}) from exc
        if result.validation is None or not result.validation.is_valid:
            raise HTTPException(
                status_code=409,
                detail="A valid schedule is required before export",
            )
        assignments = result.assignments
        summaries = result.summaries
        validation = result.validation
    else:
        assignments = payload.assignments
        validation = validate_schedule(payload.problem, assignments)
        if not validation.is_valid:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Persisted assignments failed independent validation",
                    "validation": validation.model_dump(mode="json"),
                },
            )
        summaries, _ = summarize_assignments(payload.problem, assignments)

    content = build_workbook(payload.problem, assignments, summaries, validation)
    filename = _export_filename(payload.problem.period_name)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Filename": filename,
        },
    )


app.include_router(protected_router)
