from __future__ import annotations

import base64
import binascii
from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MAX_NURSES = 100
MAX_PERIOD_DAYS = 62
MAX_SCHEDULE_ENTRIES = MAX_NURSES * MAX_PERIOD_DAYS
MAX_STAFFING_PER_SHIFT = MAX_NURSES
MAX_RAW_REQUEST_LENGTH = 120
MAX_SOURCE_WORKBOOK_BYTES = 10 * 1024 * 1024
MAX_SOURCE_WORKBOOK_BASE64_LENGTH = ((MAX_SOURCE_WORKBOOK_BYTES + 2) // 3) * 4


class SkillLevel(str, Enum):
    INCHARGE = "INCHARGE"
    TRAINEE_INC = "TRAINEE_INC"
    MEMBER_L1 = "MEMBER_L1"
    MEMBER_L2 = "MEMBER_L2"
    MEMBER_L0 = "MEMBER_L0"


class ShiftCode(str, Enum):
    DAY = "D"
    NIGHT = "N"
    OFF = "OFF"
    VACATION = "VAC"
    EDUCATION = "ED"


class OptimizationProfile(str, Enum):
    BALANCED = "balanced"
    REQUESTS_FIRST = "requests_first"
    MINIMIZE_L0 = "minimize_l0"


class RequestConstraintMode(str, Enum):
    """How the scheduler must interpret a normalized request value."""

    PREFERENCE = "PREFERENCE"
    REQUIRED = "REQUIRED"
    LOCKED = "LOCKED"


class Nurse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    nickname: str = Field(min_length=1, max_length=80)
    skill_level: SkillLevel


class RequestResolution(BaseModel):
    """Human-approved resolution for a value that the normalizer cannot decide."""

    model_config = ConfigDict(extra="forbid")

    allowed_assignments: list[ShiftCode] | None = Field(
        default=None,
        max_length=len(ShiftCode),
    )
    locked_shift: ShiftCode | None = None
    off_priority: int | None = Field(default=None, ge=1, le=4)

    @model_validator(mode="after")
    def validate_resolution(self) -> RequestResolution:
        if self.locked_shift is None and not self.allowed_assignments:
            raise ValueError("A resolution needs locked_shift or allowed_assignments")
        if self.locked_shift and self.allowed_assignments:
            if self.locked_shift not in self.allowed_assignments:
                raise ValueError("locked_shift must be included in allowed_assignments")
        return self


class DailyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nurse_id: str = Field(min_length=1, max_length=64)
    request_date: date
    raw_value: str = Field(default="", max_length=MAX_RAW_REQUEST_LENGTH)
    resolution: RequestResolution | None = None
    constraint_mode: RequestConstraintMode = RequestConstraintMode.PREFERENCE


class PreviousAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nurse_id: str = Field(min_length=1, max_length=64)
    assignment_date: date
    shift: ShiftCode


class StaffingRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minimum: int = Field(ge=0, le=MAX_STAFFING_PER_SHIFT)
    maximum: int = Field(ge=0, le=MAX_STAFFING_PER_SHIFT)

    @model_validator(mode="after")
    def validate_range(self) -> StaffingRange:
        if self.maximum < self.minimum:
            raise ValueError("maximum must be greater than or equal to minimum")
        return self


def _default_skill_ranges() -> dict[SkillLevel, StaffingRange]:
    return {
        SkillLevel.INCHARGE: StaffingRange(minimum=2, maximum=3),
        SkillLevel.TRAINEE_INC: StaffingRange(minimum=1, maximum=2),
        SkillLevel.MEMBER_L1: StaffingRange(minimum=2, maximum=5),
        SkillLevel.MEMBER_L2: StaffingRange(minimum=1, maximum=3),
        SkillLevel.MEMBER_L0: StaffingRange(minimum=0, maximum=1),
    }


class ScheduleRules(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day_staffing: int = Field(default=10, ge=1, le=MAX_STAFFING_PER_SHIFT)
    night_staffing: int = Field(default=9, ge=1, le=MAX_STAFFING_PER_SHIFT)
    skill_ranges: dict[SkillLevel, StaffingRange] = Field(
        default_factory=_default_skill_ranges,
        min_length=len(SkillLevel),
        max_length=len(SkillLevel),
    )
    max_consecutive_day: int = Field(default=3, ge=1, le=MAX_PERIOD_DAYS)
    max_consecutive_night: int = Field(default=3, ge=1, le=MAX_PERIOD_DAYS)
    max_consecutive_clinical: int = Field(default=5, ge=1, le=MAX_PERIOD_DAYS)
    max_consecutive_off_vacation: int = Field(
        default=7,
        ge=1,
        le=MAX_PERIOD_DAYS,
    )
    max_l0_clinical_shifts: int = Field(
        default=7,
        ge=0,
        le=MAX_PERIOD_DAYS,
    )
    weekend_days: set[int] = Field(default_factory=lambda: {5, 6}, max_length=7)

    @model_validator(mode="after")
    def validate_skill_ranges(self) -> ScheduleRules:
        missing = set(SkillLevel) - set(self.skill_ranges)
        if missing:
            raise ValueError(f"skill_ranges missing: {sorted(item.value for item in missing)}")
        if not self.weekend_days <= set(range(7)):
            raise ValueError("weekend_days must use Python weekday values 0 through 6")
        return self


class ScheduleProblem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period_name: str = Field(default="NurseFlow schedule", min_length=1, max_length=120)
    period_start: date
    period_end: date
    nurses: list[Nurse] = Field(min_length=1, max_length=MAX_NURSES)
    requests: list[DailyRequest] = Field(
        default_factory=list,
        max_length=MAX_SCHEDULE_ENTRIES,
    )
    previous_assignments: list[PreviousAssignment] = Field(
        default_factory=list,
        max_length=MAX_SCHEDULE_ENTRIES,
    )
    rules: ScheduleRules = Field(default_factory=ScheduleRules)
    optimization_profile: OptimizationProfile = OptimizationProfile.BALANCED
    time_limit_seconds: float = Field(default=16.0, ge=1.0, le=120.0)
    random_seed: int = Field(default=42, ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def validate_problem(self) -> ScheduleProblem:
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        period_days = (self.period_end - self.period_start).days + 1
        if period_days > MAX_PERIOD_DAYS:
            raise ValueError(
                f"The scheduling period may not exceed {MAX_PERIOD_DAYS} days"
            )

        nurse_ids = [nurse.id for nurse in self.nurses]
        if len(nurse_ids) != len(set(nurse_ids)):
            raise ValueError("Nurse ids must be unique")
        known_ids = set(nurse_ids)

        request_keys: set[tuple[str, date]] = set()
        for request in self.requests:
            if request.nurse_id not in known_ids:
                raise ValueError(f"Unknown nurse in request: {request.nurse_id}")
            if not self.period_start <= request.request_date <= self.period_end:
                raise ValueError("Requests must be inside the scheduling period")
            key = (request.nurse_id, request.request_date)
            if key in request_keys:
                raise ValueError(f"Duplicate request for {request.nurse_id} on {request.request_date}")
            request_keys.add(key)

        previous_keys: set[tuple[str, date]] = set()
        for assignment in self.previous_assignments:
            if assignment.nurse_id not in known_ids:
                raise ValueError(
                    f"Unknown nurse in previous assignment: {assignment.nurse_id}"
                )
            if assignment.assignment_date >= self.period_start:
                raise ValueError("Previous assignments must be before period_start")
            key = (assignment.nurse_id, assignment.assignment_date)
            if key in previous_keys:
                raise ValueError(
                    f"Duplicate previous assignment for {assignment.nurse_id} on "
                    f"{assignment.assignment_date}"
                )
            previous_keys.add(key)
        return self


class Assignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nurse_id: str = Field(min_length=1, max_length=64)
    nickname: str = Field(min_length=1, max_length=80)
    skill_level: SkillLevel
    assignment_date: date
    shift: ShiftCode


class NurseSummary(BaseModel):
    nurse_id: str
    nickname: str
    skill_level: SkillLevel
    day_count: int
    night_count: int
    off_count: int
    vacation_count: int
    education_count: int
    clinical_shift_count: int
    weekend_clinical_count: int
    total_hours: int


class DailyCoverage(BaseModel):
    assignment_date: date
    day_count: int
    night_count: int
    day_skill_counts: dict[SkillLevel, int]
    night_skill_counts: dict[SkillLevel, int]


class ValidationCheck(BaseModel):
    code: str
    name: str
    status: Literal["PASS", "FAIL"]
    violation_count: int
    details: list[str] = Field(default_factory=list)


class ValidationReport(BaseModel):
    is_valid: bool
    checks: list[ValidationCheck]


class PhaseResult(BaseModel):
    name: str
    direction: Literal["MAXIMIZE", "MINIMIZE"]
    status: str
    value: int
    proven_optimal: bool


class GenerateResponse(BaseModel):
    status: str
    message: str
    assignments: list[Assignment] = Field(default_factory=list)
    summaries: list[NurseSummary] = Field(default_factory=list)
    daily_coverage: list[DailyCoverage] = Field(default_factory=list)
    metrics: dict[str, int | float | str] = Field(default_factory=dict)
    phases: list[PhaseResult] = Field(default_factory=list)
    validation: ValidationReport | None = None
    solver_duration_ms: int = 0


class SourceWorkbookTemplate(BaseModel):
    """Sanitized source sheet plus server-generated cell mappings for export."""

    model_config = ConfigDict(extra="forbid")

    content_base64: str = Field(
        min_length=1,
        max_length=MAX_SOURCE_WORKBOOK_BASE64_LENGTH,
    )
    worksheet_name: str = Field(min_length=1, max_length=31)
    nurse_rows: dict[str, int] = Field(min_length=1, max_length=MAX_NURSES)
    date_columns: dict[date, int] = Field(min_length=1, max_length=MAX_PERIOD_DAYS)

    @field_validator("content_base64")
    @classmethod
    def validate_workbook_content(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("source workbook content must be valid base64") from exc
        if len(decoded) > MAX_SOURCE_WORKBOOK_BYTES:
            raise ValueError("source workbook exceeds the 10 MB limit")
        if not decoded.startswith(b"PK"):
            raise ValueError("source workbook must be an xlsx file")
        return value

    @field_validator("nurse_rows")
    @classmethod
    def validate_nurse_rows(cls, value: dict[str, int]) -> dict[str, int]:
        if any(not nurse_id or len(nurse_id) > 64 for nurse_id in value):
            raise ValueError("source workbook nurse ids are invalid")
        if any(row < 1 or row > 1_048_576 for row in value.values()):
            raise ValueError("source workbook nurse rows are invalid")
        if len(set(value.values())) != len(value):
            raise ValueError("source workbook nurse rows must be unique")
        return value

    @field_validator("date_columns")
    @classmethod
    def validate_date_columns(cls, value: dict[date, int]) -> dict[date, int]:
        if any(column < 1 or column > 16_384 for column in value.values()):
            raise ValueError("source workbook date columns are invalid")
        if len(set(value.values())) != len(value):
            raise ValueError("source workbook date columns must be unique")
        return value


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    problem: ScheduleProblem
    assignments: list[Assignment] | None = Field(
        default=None,
        max_length=MAX_SCHEDULE_ENTRIES,
    )
    source_workbook_template: SourceWorkbookTemplate | None = None
