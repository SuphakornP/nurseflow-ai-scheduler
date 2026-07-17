from __future__ import annotations

import json
import logging
import re
from io import BytesIO

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from .auth import require_solver_token
from .demo import build_demo_problem
from .export import WorkbookTemplateError, build_workbook
from .models import (
    ExportRequest,
    GenerateResponse,
    OptimizationProfile,
    ScheduleProblem,
)
from .solver import InputProblemError, generate_schedule, summarize_assignments
from .validation import validate_schedule


logger = logging.getLogger("nurseflow.solver")
SAFE_REQUEST_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
SAFE_ISSUE_TYPE = re.compile(r"^[a-zA-Z0-9_.-]{1,64}$")
SOLVER_TOP_LEVEL_FIELDS = {
    "period_name",
    "period_start",
    "period_end",
    "nurses",
    "requests",
    "previous_assignments",
    "rules",
    "optimization_profile",
    "time_limit_seconds",
    "random_seed",
}


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


def _request_id(request: Request) -> str | None:
    value = request.headers.get("x-request-id", "")
    return value if SAFE_REQUEST_ID.fullmatch(value) else None


def _input_problem_reason(error: str) -> str:
    if "needs review" in error:
        return "UNRESOLVED_REQUEST"
    if "Vacation must use LOCKED" in error:
        return "VACATION_MODE"
    if "Education must be LOCKED" in error:
        return "EDUCATION_MODE"
    if "O/D and O/N must use REQUIRED" in error:
        return "FLEXIBLE_REQUEST_MODE"
    if "REQUIRED mode needs" in error:
        return "REQUIRED_REQUEST_MODE"
    if any(
        marker in error
        for marker in ("Not enough nurses", "needs at least", "staffing target")
    ):
        return "STAFFING_PREFLIGHT"
    return "INPUT_PROBLEM"


def _input_problem_detail(errors: list[str]) -> dict[str, object]:
    return {
        "issue_count": max(len(errors), 1),
        "reason_codes": sorted({_input_problem_reason(error) for error in errors}),
    }


def _safe_validation_path(location: tuple[object, ...]) -> str | None:
    field = next(
        (
            segment
            for segment in location
            if isinstance(segment, str) and segment in SOLVER_TOP_LEVEL_FIELDS
        ),
        None,
    )
    if field is None:
        return None
    return f"{field}[]" if any(isinstance(segment, int) for segment in location) else field


def _log_rejection(
    event: str,
    request: Request,
    detail: dict[str, object],
    **counts: int | str,
) -> None:
    logger.warning(
        json.dumps(
            {
                "event": event,
                "request_id": _request_id(request),
                "status": 422,
                **counts,
                **detail,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    issues = exc.errors()
    detail: dict[str, object] = {
        "issue_count": max(len(issues), 1),
        "reason_codes": ["PAYLOAD_VALIDATION"],
        "issue_types": sorted(
            {
                issue_type
                for issue in issues
                if isinstance((issue_type := issue.get("type")), str)
                and SAFE_ISSUE_TYPE.fullmatch(issue_type)
            }
        )[:12],
        "field_paths": sorted(
            {
                path
                for issue in issues
                if isinstance(issue.get("loc"), tuple)
                and (path := _safe_validation_path(issue["loc"])) is not None
            }
        )[:12],
    }
    _log_rejection("solver.request.schema_rejected", request, detail)
    return JSONResponse(status_code=422, content={"detail": detail})


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
def generate(problem: ScheduleProblem, request: Request) -> GenerateResponse:
    try:
        return generate_schedule(problem)
    except InputProblemError as exc:
        detail = _input_problem_detail(exc.errors)
        _log_rejection(
            "solver.generate.input_rejected",
            request,
            detail,
            nurse_count=len(problem.nurses),
            request_count=len(problem.requests),
            previous_assignment_count=len(problem.previous_assignments),
            optimization_profile=problem.optimization_profile.value,
        )
        raise HTTPException(status_code=422, detail=detail) from exc


@protected_router.post("/export")
def export(payload: ExportRequest, request: Request) -> StreamingResponse:
    if payload.assignments is None:
        try:
            result = generate_schedule(payload.problem)
        except InputProblemError as exc:
            detail = _input_problem_detail(exc.errors)
            _log_rejection(
                "solver.export.input_rejected",
                request,
                detail,
                nurse_count=len(payload.problem.nurses),
                request_count=len(payload.problem.requests),
                previous_assignment_count=len(payload.problem.previous_assignments),
                optimization_profile=payload.problem.optimization_profile.value,
            )
            raise HTTPException(status_code=422, detail=detail) from exc
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

    try:
        content = build_workbook(
            payload.problem,
            assignments,
            summaries,
            validation,
            payload.source_workbook_template,
        )
    except WorkbookTemplateError as exc:
        raise HTTPException(
            status_code=422,
            detail="The source workbook template is invalid",
        ) from exc
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
