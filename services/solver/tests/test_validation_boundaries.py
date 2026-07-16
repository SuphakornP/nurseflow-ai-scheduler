from __future__ import annotations

from datetime import timedelta

from app.models import PreviousAssignment, ShiftCode, SkillLevel
from app.validation import validate_schedule

from conftest import make_assignments, make_problem


def _status(report, code: str) -> str:
    return next(item.status for item in report.checks if item.code == code)


def test_day_run_continues_across_month_boundary(
    tiny_nurses, permissive_skill_ranges
) -> None:
    start = make_problem(
        days=1, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    ).period_start
    previous = [
        PreviousAssignment(
            nurse_id="A",
            assignment_date=start - timedelta(days=offset),
            shift=ShiftCode.DAY,
        )
        for offset in (3, 2, 1)
    ]
    problem = make_problem(
        days=1,
        nurses=tiny_nurses,
        skill_ranges=permissive_skill_ranges,
        previous=previous,
    )
    assignments = make_assignments(
        problem,
        {"A": [ShiftCode.DAY], "B": [ShiftCode.NIGHT], "C": [ShiftCode.OFF]},
    )
    report = validate_schedule(problem, assignments)
    assert _status(report, "MAX_CONSECUTIVE_DAY") == "FAIL"


def test_night_to_day_is_checked_across_month_boundary(
    tiny_nurses, permissive_skill_ranges
) -> None:
    start = make_problem(
        days=1, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    ).period_start
    problem = make_problem(
        days=1,
        nurses=tiny_nurses,
        skill_ranges=permissive_skill_ranges,
        previous=[
            PreviousAssignment(
                nurse_id="A",
                assignment_date=start - timedelta(days=1),
                shift=ShiftCode.NIGHT,
            )
        ],
    )
    assignments = make_assignments(
        problem,
        {"A": [ShiftCode.DAY], "B": [ShiftCode.NIGHT], "C": [ShiftCode.OFF]},
    )
    report = validate_schedule(problem, assignments)
    assert _status(report, "NIGHT_TO_DAY") == "FAIL"


def test_night_to_education_is_checked_across_month_boundary(
    tiny_nurses, permissive_skill_ranges
) -> None:
    start = make_problem(
        days=1, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    ).period_start
    problem = make_problem(
        days=1,
        nurses=tiny_nurses,
        skill_ranges=permissive_skill_ranges,
        previous=[
            PreviousAssignment(
                nurse_id="A",
                assignment_date=start - timedelta(days=1),
                shift=ShiftCode.NIGHT,
            )
        ],
    )
    assignments = make_assignments(
        problem,
        {
            "A": [ShiftCode.EDUCATION],
            "B": [ShiftCode.DAY],
            "C": [ShiftCode.NIGHT],
        },
    )
    report = validate_schedule(problem, assignments)
    assert _status(report, "NIGHT_TO_EDUCATION") == "FAIL"


def test_six_clinical_days_fail_but_three_day_and_three_night_do_not(
    tiny_nurses, permissive_skill_ranges
) -> None:
    problem = make_problem(
        days=6, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    )
    assignments = make_assignments(
        problem,
        {
            "A": [
                ShiftCode.DAY,
                ShiftCode.DAY,
                ShiftCode.DAY,
                ShiftCode.NIGHT,
                ShiftCode.NIGHT,
                ShiftCode.NIGHT,
            ],
            "B": [
                ShiftCode.NIGHT,
                ShiftCode.NIGHT,
                ShiftCode.NIGHT,
                ShiftCode.DAY,
                ShiftCode.DAY,
                ShiftCode.DAY,
            ],
            "C": [ShiftCode.OFF] * 6,
        },
    )
    report = validate_schedule(problem, assignments)
    assert _status(report, "MAX_CONSECUTIVE_CLINICAL") == "FAIL"
    assert _status(report, "MAX_CONSECUTIVE_DAY") == "PASS"
    assert _status(report, "MAX_CONSECUTIVE_NIGHT") == "PASS"


def test_eight_off_or_vacation_days_fail(
    tiny_nurses, permissive_skill_ranges
) -> None:
    problem = make_problem(
        days=8, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    )
    assignments = make_assignments(
        problem,
        {
            "A": [ShiftCode.OFF, ShiftCode.VACATION] * 4,
            "B": [ShiftCode.DAY] * 8,
            "C": [ShiftCode.NIGHT] * 8,
        },
    )
    report = validate_schedule(problem, assignments)
    assert _status(report, "MAX_CONSECUTIVE_OFF_VACATION") == "FAIL"


def test_member_l0_eight_clinical_shifts_fail(
    tiny_nurses, permissive_skill_ranges
) -> None:
    problem = make_problem(
        days=8, nurses=tiny_nurses, skill_ranges=permissive_skill_ranges
    )
    assignments = make_assignments(
        problem,
        {
            "A": [ShiftCode.OFF] * 8,
            "B": [ShiftCode.NIGHT] * 8,
            "C": [ShiftCode.DAY] * 8,
        },
    )
    report = validate_schedule(problem, assignments)
    assert next(
        item.skill_level for item in tiny_nurses if item.id == "C"
    ) == SkillLevel.MEMBER_L0
    assert _status(report, "MEMBER_L0_LIMIT") == "FAIL"
