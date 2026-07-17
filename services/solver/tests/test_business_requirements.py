from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models import (
    DailyRequest,
    Nurse,
    RequestConstraintMode,
    ScheduleProblem,
    ScheduleRules,
    ShiftCode,
    SkillLevel,
    StaffingRange,
)
from app.normalization import find_long_off_blocks
from app.solver import generate_schedule, prepare_requests
from app.validation import validate_schedule

from conftest import make_assignments


def _ranges(maximum: int = 20) -> dict[SkillLevel, StaffingRange]:
    return {
        level: StaffingRange(minimum=0, maximum=maximum) for level in SkillLevel
    }


def _senior_nurses(count: int, *, include_l0: bool = False) -> list[Nurse]:
    nurses = [
        Nurse(
            id=f"S{index}",
            nickname=f"Synthetic {index}",
            skill_level=SkillLevel.INCHARGE,
        )
        for index in range(count)
    ]
    if include_l0:
        nurses.append(
            Nurse(id="L0", nickname="Synthetic L0", skill_level=SkillLevel.MEMBER_L0)
        )
    return nurses


def _problem(
    *,
    days: int,
    nurses: list[Nurse],
    requests: list[DailyRequest] | None = None,
    start: date = date(2026, 8, 3),
    time_limit_seconds: float = 4,
) -> ScheduleProblem:
    return ScheduleProblem(
        period_name="Synthetic business-rule fixture",
        period_start=start,
        period_end=start + timedelta(days=days - 1),
        nurses=nurses,
        requests=requests or [],
        rules=ScheduleRules(
            day_staffing=3,
            night_staffing=3,
            skill_ranges=_ranges(),
        ),
        time_limit_seconds=time_limit_seconds,
    )


def _request(
    nurse_id: str,
    request_date: date,
    raw_value: str,
    mode: RequestConstraintMode = RequestConstraintMode.PREFERENCE,
) -> DailyRequest:
    return DailyRequest(
        nurse_id=nurse_id,
        request_date=request_date,
        raw_value=raw_value,
        constraint_mode=mode,
    )


def _check_status(result, code: str) -> str:
    assert result.validation is not None
    return next(item.status for item in result.validation.checks if item.code == code)


def test_l0_weekday_defaults_to_education_but_an_off_request_may_win() -> None:
    nurses = _senior_nurses(7, include_l0=True)
    without_request = generate_schedule(_problem(days=1, nurses=nurses))

    l0_assignment = next(
        item for item in without_request.assignments if item.nurse_id == "L0"
    )
    assert l0_assignment.shift == ShiftCode.EDUCATION
    assert _check_status(without_request, "MEMBER_L0_WEEKDAY_DEFAULT") == "PASS"

    start = date(2026, 8, 3)
    with_off_request = generate_schedule(
        _problem(
            days=1,
            nurses=nurses,
            requests=[_request("L0", start, "O1")],
        )
    )
    requested_assignment = next(
        item for item in with_off_request.assignments if item.nurse_id == "L0"
    )
    assert requested_assignment.shift == ShiftCode.OFF
    assert _check_status(with_off_request, "MEMBER_L0_WEEKDAY_DEFAULT") == "PASS"


def test_l0_education_is_an_allowed_preference() -> None:
    nurses = _senior_nurses(7, include_l0=True)
    start = date(2026, 8, 3)
    result = generate_schedule(
        _problem(
            days=1,
            nurses=nurses,
            requests=[_request("L0", start, "ED")],
        )
    )

    assert next(item for item in result.assignments if item.nurse_id == "L0").shift == ShiftCode.EDUCATION
    assert result.validation is not None and result.validation.is_valid


def test_five_day_off_block_may_lose_at_most_one_requested_day() -> None:
    nurses = _senior_nurses(10)
    start = date(2026, 8, 3)
    requests = [
        _request("S0", start + timedelta(days=offset), "O1")
        for offset in range(5)
    ]
    result = generate_schedule(_problem(days=5, nurses=nurses, requests=requests))

    assigned = [
        item.shift
        for item in result.assignments
        if item.nurse_id == "S0"
    ]
    assert assigned.count(ShiftCode.OFF) >= 4
    assert result.validation is not None and result.validation.is_valid
    assert _check_status(result, "LONG_OFF_BLOCK_PRESERVED") == "PASS"


def test_locked_vacation_connects_a_mixed_long_off_block() -> None:
    nurses = _senior_nurses(10)
    start = date(2026, 8, 3)
    raw_values = ["O1", "VAC", "O2", "VAC", "O3"]
    requests = [
        _request(
            "S0",
            start + timedelta(days=offset),
            raw_value,
            RequestConstraintMode.LOCKED
            if raw_value == "VAC"
            else RequestConstraintMode.PREFERENCE,
        )
        for offset, raw_value in enumerate(raw_values)
    ]
    problem = _problem(days=5, nurses=nurses, requests=requests)

    blocks = find_long_off_blocks(prepare_requests(problem))

    assert len(blocks) == 1
    assert len(blocks[0].dates) == 5
    assert len(blocks[0].off_dates) == 3
    assert len(blocks[0].vacation_dates) == 2


def test_validator_fails_closed_when_locked_vacation_is_changed() -> None:
    nurses = _senior_nurses(7)
    start = date(2026, 8, 3)
    problem = _problem(
        days=1,
        nurses=nurses,
        requests=[
            _request("S0", start, "VAC", RequestConstraintMode.LOCKED)
        ],
    )
    patterns = {
        "S0": [ShiftCode.OFF],
        "S1": [ShiftCode.DAY],
        "S2": [ShiftCode.DAY],
        "S3": [ShiftCode.DAY],
        "S4": [ShiftCode.NIGHT],
        "S5": [ShiftCode.NIGHT],
        "S6": [ShiftCode.NIGHT],
    }

    report = validate_schedule(problem, make_assignments(problem, patterns))
    vacation_check = next(
        item for item in report.checks if item.code == "VACATION_PRESERVED"
    )
    assert vacation_check.status == "FAIL"
    assert vacation_check.violation_count == 1


def test_long_off_block_returns_infeasible_when_one_cut_cannot_satisfy_safety() -> None:
    nurses = _senior_nurses(10)
    start = date(2026, 8, 3)
    baseline = generate_schedule(_problem(days=16, nurses=nurses, time_limit_seconds=6))
    assert baseline.status in {"OPTIMAL", "FEASIBLE"}

    requests = [
        _request("S0", start + timedelta(days=offset), "O1")
        for offset in range(16)
    ]
    constrained = generate_schedule(
        _problem(
            days=16,
            nurses=nurses,
            requests=requests,
            time_limit_seconds=6,
        )
    )

    assert constrained.status == "INFEASIBLE"
    assert constrained.assignments == []


def test_validator_rejects_two_missed_days_in_a_long_off_block() -> None:
    nurses = _senior_nurses(7)
    start = date(2026, 8, 3)
    problem = _problem(
        days=5,
        nurses=nurses,
        requests=[
            _request("S0", start + timedelta(days=offset), "O1")
            for offset in range(5)
        ],
    )
    assignments = make_assignments(
        problem,
        {
            "S0": [
                ShiftCode.DAY,
                ShiftCode.NIGHT,
                ShiftCode.OFF,
                ShiftCode.OFF,
                ShiftCode.OFF,
            ]
        },
    )

    report = validate_schedule(problem, assignments)
    check = next(item for item in report.checks if item.code == "LONG_OFF_BLOCK_PRESERVED")
    assert check.status == "FAIL"
    assert check.violation_count == 1


def test_infeasible_fixed_events_report_skill_capacity_without_identifiers() -> None:
    skill_counts = {
        SkillLevel.INCHARGE: 8,
        SkillLevel.TRAINEE_INC: 4,
        SkillLevel.MEMBER_L1: 11,
        SkillLevel.MEMBER_L2: 4,
        SkillLevel.MEMBER_L0: 1,
    }
    nurses = [
        Nurse(
            id=f"{skill_level.value}-{index}",
            nickname=f"Synthetic {skill_level.value} {index}",
            skill_level=skill_level,
        )
        for skill_level, count in skill_counts.items()
        for index in range(count)
    ]
    request_date = date(2026, 8, 26)
    requests = [
        _request(
            "TRAINEE_INC-0",
            request_date,
            "VAC",
            RequestConstraintMode.LOCKED,
        ),
        _request(
            "TRAINEE_INC-1",
            request_date,
            "ED",
            RequestConstraintMode.LOCKED,
        ),
        _request(
            "TRAINEE_INC-2",
            request_date,
            "ED",
            RequestConstraintMode.LOCKED,
        ),
    ]
    problem = ScheduleProblem(
        period_name="Synthetic capacity conflict",
        period_start=request_date,
        period_end=request_date,
        nurses=nurses,
        requests=requests,
        time_limit_seconds=2,
    )

    result = generate_schedule(problem)

    assert result.status == "INFEASIBLE"
    assert result.validation is not None and not result.validation.is_valid
    check = result.validation.checks[0]
    assert check.code == "MANDATORY_SKILL_CAPACITY"
    assert check.violation_count == 1
    assert "2026-08-26" in check.details[0]
    assert "1 available" in check.details[0]
    assert "require at least 2" in check.details[0]
    assert "TRAINEE_INC-0" not in check.details[0]


def test_off_priorities_precede_all_shared_soft_objectives() -> None:
    nurses = _senior_nurses(7)
    start = date(2026, 8, 3)
    requests = [
        _request("S0", start, "O1"),
        _request("S1", start, "O2"),
        _request("S2", start, "O3"),
        _request("S3", start, "O4"),
        _request("S4", start, "D"),
    ]
    result = generate_schedule(_problem(days=1, nurses=nurses, requests=requests))
    phase_names = [item.name for item in result.phases]

    assert phase_names[:5] == [
        "MAXIMIZE_O1",
        "MAXIMIZE_O2",
        "MAXIMIZE_O3",
        "MAXIMIZE_O4",
        "MAXIMIZE_REQUEST_PREFERENCES",
    ]
    assert phase_names[-1].startswith("TIE_BREAK_PROFILE_")
    assert next(item for item in result.assignments if item.nurse_id == "S0").shift == ShiftCode.OFF
    assert _check_status(result, "OFF_PRIORITY_NORMALIZED") == "PASS"


@pytest.mark.parametrize(
    ("raw_value", "wrong_shift"),
    [("O/D", ShiftCode.NIGHT), ("O/N", ShiftCode.DAY)],
)
def test_validator_has_explicit_required_domain_evidence(
    raw_value: str,
    wrong_shift: ShiftCode,
) -> None:
    nurses = _senior_nurses(7)
    start = date(2026, 8, 3)
    problem = _problem(
        days=1,
        nurses=nurses,
        requests=[
            _request("S0", start, raw_value, RequestConstraintMode.REQUIRED)
        ],
    )
    patterns = {
        "S0": [wrong_shift],
        "S1": [ShiftCode.DAY],
        "S2": [ShiftCode.DAY],
        "S3": [ShiftCode.NIGHT],
        "S4": [ShiftCode.NIGHT],
        "S5": [ShiftCode.DAY if wrong_shift == ShiftCode.NIGHT else ShiftCode.NIGHT],
        "S6": [ShiftCode.OFF],
    }
    report = validate_schedule(problem, make_assignments(problem, patterns))

    check = next(
        item for item in report.checks if item.code == "REQUIRED_ASSIGNMENT_ALLOWED"
    )
    assert check.status == "FAIL"
