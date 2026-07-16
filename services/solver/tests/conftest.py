from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.demo import build_demo_problem
from app.models import (
    Assignment,
    Nurse,
    OptimizationProfile,
    PreviousAssignment,
    ScheduleProblem,
    ScheduleRules,
    ShiftCode,
    SkillLevel,
    StaffingRange,
)
from app.solver import generate_schedule


@pytest.fixture
def permissive_skill_ranges() -> dict[SkillLevel, StaffingRange]:
    return {
        level: StaffingRange(minimum=0, maximum=3) for level in SkillLevel
    }


@pytest.fixture
def tiny_nurses() -> list[Nurse]:
    return [
        Nurse(id="A", nickname="Alpha", skill_level=SkillLevel.INCHARGE),
        Nurse(id="B", nickname="Beta", skill_level=SkillLevel.TRAINEE_INC),
        Nurse(id="C", nickname="Gamma", skill_level=SkillLevel.MEMBER_L0),
    ]


def make_problem(
    *,
    days: int,
    nurses: list[Nurse],
    skill_ranges: dict[SkillLevel, StaffingRange],
    previous: list[PreviousAssignment] | None = None,
) -> ScheduleProblem:
    start = date(2026, 8, 1)
    return ScheduleProblem(
        period_name="Boundary fixture",
        period_start=start,
        period_end=start + timedelta(days=days - 1),
        nurses=nurses,
        previous_assignments=previous or [],
        rules=ScheduleRules(
            day_staffing=1,
            night_staffing=1,
            skill_ranges=skill_ranges,
        ),
        time_limit_seconds=2,
    )


def make_assignments(
    problem: ScheduleProblem,
    patterns: dict[str, list[ShiftCode]],
) -> list[Assignment]:
    nurses = {item.id: item for item in problem.nurses}
    day_count = (problem.period_end - problem.period_start).days + 1
    assignments: list[Assignment] = []
    for nurse_id, nurse in nurses.items():
        shifts = patterns.get(nurse_id, [ShiftCode.OFF] * day_count)
        assert len(shifts) == day_count
        for offset, shift in enumerate(shifts):
            assignments.append(
                Assignment(
                    nurse_id=nurse_id,
                    nickname=nurse.nickname,
                    skill_level=nurse.skill_level,
                    assignment_date=problem.period_start + timedelta(days=offset),
                    shift=shift,
                )
            )
    return assignments


@pytest.fixture(scope="session")
def generated_profiles():
    results = {}
    for profile in OptimizationProfile:
        problem = build_demo_problem(profile).model_copy(
            update={"time_limit_seconds": 12.0}
        )
        results[profile] = (problem, generate_schedule(problem))
    return results


@pytest.fixture(scope="session")
def generated_demo(generated_profiles):
    return generated_profiles[OptimizationProfile.BALANCED]
