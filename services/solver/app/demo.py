from __future__ import annotations

from datetime import date, timedelta

from .models import (
    DailyRequest,
    Nurse,
    OptimizationProfile,
    PreviousAssignment,
    RequestConstraintMode,
    ScheduleProblem,
    SkillLevel,
    ShiftCode,
)


_NICKNAMES = [
    "Mint",
    "Beam",
    "Ploy",
    "Fah",
    "May",
    "Nan",
    "Aom",
    "Gift",
    "Pear",
    "Praew",
    "Mook",
    "Bam",
    "June",
    "Fern",
    "Mind",
    "Ice",
    "View",
    "Noon",
    "Ning",
    "Bow",
    "Earn",
    "Kwan",
    "Som",
    "Fon",
    "Pim",
    "Oil",
    "Dao",
    "Jan",
]


def _nurses() -> list[Nurse]:
    levels = (
        [SkillLevel.INCHARGE] * 8
        + [SkillLevel.TRAINEE_INC] * 4
        + [SkillLevel.MEMBER_L1] * 11
        + [SkillLevel.MEMBER_L2] * 4
        + [SkillLevel.MEMBER_L0]
    )
    counters: dict[SkillLevel, int] = {level: 0 for level in SkillLevel}
    prefixes = {
        SkillLevel.INCHARGE: "IC",
        SkillLevel.TRAINEE_INC: "TR",
        SkillLevel.MEMBER_L1: "L1",
        SkillLevel.MEMBER_L2: "L2",
        SkillLevel.MEMBER_L0: "L0",
    }
    nurses: list[Nurse] = []
    for nickname, level in zip(_NICKNAMES, levels, strict=True):
        counters[level] += 1
        nurses.append(
            Nurse(
                id=f"{prefixes[level]}{counters[level]:02d}",
                nickname=nickname,
                skill_level=level,
            )
        )
    return nurses


def build_demo_problem(
    optimization_profile: OptimizationProfile = OptimizationProfile.BALANCED,
) -> ScheduleProblem:
    period_start = date(2026, 8, 1)
    period_end = date(2026, 8, 31)
    nurses = _nurses()
    requests: list[DailyRequest] = []

    # Each nurse has deterministic, distributed OFF priorities. Dates are derived
    # from the stable list position rather than Python's randomized hash function.
    for index, nurse in enumerate(nurses):
        used_days: set[int] = set()
        for priority in range(1, 5):
            day = ((index * 5 + priority * 7) % 31) + 1
            while day in used_days:
                day = (day % 31) + 1
            used_days.add(day)
            requests.append(
                DailyRequest(
                    nurse_id=nurse.id,
                    request_date=date(2026, 8, day),
                    raw_value=f"O{priority}",
                )
            )

    # Concentrate requests inside two scarce skill groups so the showcase has
    # genuine, explainable rejections. Incharge coverage requires four people
    # across Day/Night, and Trainee Inc. coverage requires two.
    conflict_requests = [
        *[(f"IC{index:02d}", 14, 1 + ((index - 1) // 2)) for index in range(1, 9)],
        *[(f"TR{index:02d}", 22, index) for index in range(1, 5)],
    ]
    conflict_keys = {
        (nurse_id, date(2026, 8, day))
        for nurse_id, day, _priority in conflict_requests
    }
    requests = [
        item
        for item in requests
        if (item.nurse_id, item.request_date) not in conflict_keys
    ]
    requests.extend(
        DailyRequest(
            nurse_id=nurse_id,
            request_date=date(2026, 8, day),
            raw_value=f"O{priority}",
        )
        for nurse_id, day, priority in conflict_requests
    )

    # A small number of immutable VAC/ED events and required flexible choices
    # demonstrate the production request contract while retaining ample capacity.
    locked_events = [
        ("IC01", 6, "Vac"),
        ("TR01", 11, "VAC"),
        ("L105", 17, "vac"),
        ("L202", 23, "Vac"),
        ("IC04", 9, "ED"),
        ("L109", 14, "\u0e0aED"),
        ("TR03", 20, "O/D"),
        ("L203", 27, "N/O"),
    ]
    existing_keys = {(item.nurse_id, item.request_date) for item in requests}
    for nurse_id, day, raw_value in locked_events:
        key = (nurse_id, date(2026, 8, day))
        if key in existing_keys:
            requests = [
                item
                for item in requests
                if (item.nurse_id, item.request_date) != key
            ]
        requests.append(
            DailyRequest(
                nurse_id=nurse_id,
                request_date=key[1],
                raw_value=raw_value,
                constraint_mode=(
                    RequestConstraintMode.REQUIRED
                    if "/" in raw_value
                    else RequestConstraintMode.LOCKED
                ),
            )
        )

    # The previous three days are included for every nurse. A rotating pattern
    # exercises month-boundary logic without forcing a particular August shift.
    previous_assignments: list[PreviousAssignment] = []
    history_start = period_start - timedelta(days=3)
    history_patterns = (
        (ShiftCode.OFF, ShiftCode.DAY, ShiftCode.DAY),
        (ShiftCode.OFF, ShiftCode.NIGHT, ShiftCode.NIGHT),
        (ShiftCode.DAY, ShiftCode.OFF, ShiftCode.DAY),
        (ShiftCode.NIGHT, ShiftCode.OFF, ShiftCode.NIGHT),
        (ShiftCode.OFF, ShiftCode.OFF, ShiftCode.OFF),
    )
    for index, nurse in enumerate(nurses):
        pattern = history_patterns[index % len(history_patterns)]
        for offset, shift in enumerate(pattern):
            previous_assignments.append(
                PreviousAssignment(
                    nurse_id=nurse.id,
                    assignment_date=history_start + timedelta(days=offset),
                    shift=shift,
                )
            )

    return ScheduleProblem(
        period_name="MICU August 2026 demo",
        period_start=period_start,
        period_end=period_end,
        nurses=nurses,
        requests=sorted(
            requests,
            key=lambda item: (item.request_date, item.nurse_id),
        ),
        previous_assignments=previous_assignments,
        optimization_profile=optimization_profile,
        time_limit_seconds=16.0,
        random_seed=202608,
    )
