from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta

from .models import (
    Assignment,
    RequestConstraintMode,
    ScheduleProblem,
    ShiftCode,
    SkillLevel,
    ValidationCheck,
    ValidationReport,
)
from .normalization import (
    NormalizationStatus,
    RequestKind,
    find_long_off_blocks,
    normalize_request,
    request_semantics_error,
)


def _check(code: str, name: str, details: list[str]) -> ValidationCheck:
    return ValidationCheck(
        code=code,
        name=name,
        status="FAIL" if details else "PASS",
        violation_count=len(details),
        details=details,
    )


def _period_dates(problem: ScheduleProblem) -> list[date]:
    return [
        problem.period_start + timedelta(days=offset)
        for offset in range((problem.period_end - problem.period_start).days + 1)
    ]


def validate_schedule(
    problem: ScheduleProblem, assignments: list[Assignment]
) -> ValidationReport:
    dates = _period_dates(problem)
    nurse_by_id = {nurse.id: nurse for nurse in problem.nurses}
    checks: list[ValidationCheck] = []

    completeness_details: list[str] = []
    assignment_counter = Counter(
        (assignment.nurse_id, assignment.assignment_date)
        for assignment in assignments
    )
    for key, count in assignment_counter.items():
        if count > 1:
            completeness_details.append(
                f"{key[0]} {key[1]} has {count} assignments"
            )
    for assignment in assignments:
        if assignment.nurse_id not in nurse_by_id:
            completeness_details.append(
                f"Unknown nurse {assignment.nurse_id} in assignments"
            )
        if not problem.period_start <= assignment.assignment_date <= problem.period_end:
            completeness_details.append(
                f"{assignment.nurse_id} has assignment outside period on "
                f"{assignment.assignment_date}"
            )
    for nurse in problem.nurses:
        for assignment_date in dates:
            if assignment_counter[(nurse.id, assignment_date)] == 0:
                completeness_details.append(
                    f"{nurse.id} missing assignment on {assignment_date}"
                )
    checks.append(
        _check(
            "SINGLE_COMPLETE_ASSIGNMENT",
            "Exactly one assignment per nurse and date",
            completeness_details,
        )
    )

    assignment_map = {
        (assignment.nurse_id, assignment.assignment_date): assignment.shift
        for assignment in assignments
        if assignment.nurse_id in nurse_by_id
        and problem.period_start <= assignment.assignment_date <= problem.period_end
    }
    previous_map = {
        (assignment.nurse_id, assignment.assignment_date): assignment.shift
        for assignment in problem.previous_assignments
    }

    day_staffing_details: list[str] = []
    night_staffing_details: list[str] = []
    skill_mix_details: list[str] = []
    forbidden_mix_details: list[str] = []
    for assignment_date in dates:
        for shift, expected, staffing_details in (
            (ShiftCode.DAY, problem.rules.day_staffing, day_staffing_details),
            (ShiftCode.NIGHT, problem.rules.night_staffing, night_staffing_details),
        ):
            selected = [
                nurse
                for nurse in problem.nurses
                if assignment_map.get((nurse.id, assignment_date)) == shift
            ]
            if len(selected) != expected:
                staffing_details.append(
                    f"{assignment_date} {shift.value}: expected {expected}, got {len(selected)}"
                )
            level_counts = Counter(nurse.skill_level for nurse in selected)
            for level, staffing_range in problem.rules.skill_ranges.items():
                count = level_counts[level]
                if not staffing_range.minimum <= count <= staffing_range.maximum:
                    skill_mix_details.append(
                        f"{assignment_date} {shift.value} {level.value}: "
                        f"expected {staffing_range.minimum}..{staffing_range.maximum}, got {count}"
                    )
            incharge_and_trainee = (
                level_counts[SkillLevel.INCHARGE]
                + level_counts[SkillLevel.TRAINEE_INC]
            )
            if (
                incharge_and_trainee == 3
                and level_counts[SkillLevel.MEMBER_L2] == 3
            ):
                forbidden_mix_details.append(
                    f"{assignment_date} {shift.value}: Incharge+Trainee=3 and L2=3"
                )
    checks.extend(
        [
            _check("DAY_STAFFING", "Daily Day staffing", day_staffing_details),
            _check("NIGHT_STAFFING", "Daily Night staffing", night_staffing_details),
            _check("SKILL_MIX", "Per-shift skill ranges", skill_mix_details),
            _check(
                "FORBIDDEN_SKILL_MIX",
                "Forbidden minimum senior mix with three L2 nurses",
                forbidden_mix_details,
            ),
        ]
    )

    locked_vacation_details: list[str] = []
    locked_education_details: list[str] = []
    locked_clinical_details: list[str] = []
    required_assignment_details: list[str] = []
    flexible_details: list[str] = []
    normalization_details: list[str] = []
    request_semantics_details: list[str] = []
    off_priority_details: list[str] = []
    prepared_requests = {}
    for request in problem.requests:
        normalized = normalize_request(request)
        prepared_requests[(request.nurse_id, request.request_date)] = normalized
        if normalized.status == NormalizationStatus.NEEDS_REVIEW:
            normalization_details.append(
                f"{request.nurse_id} {request.request_date}: '{request.raw_value}' unresolved"
            )
            continue
        semantics_error = request_semantics_error(
            normalized,
            nurse_by_id[request.nurse_id].skill_level,
        )
        if semantics_error:
            request_semantics_details.append(
                f"{request.nurse_id} {request.request_date}: {semantics_error}"
            )
        if (
            normalized.kind == RequestKind.OFF_REQUEST
            and normalized.off_priority not in {1, 2, 3, 4}
        ):
            off_priority_details.append(
                f"{request.nurse_id} {request.request_date}: missing O1-O4 priority"
            )
        actual = assignment_map.get((request.nurse_id, request.request_date))
        allowed = normalized.allowed_assignments or frozenset()
        if allowed == frozenset({ShiftCode.VACATION}) and actual != ShiftCode.VACATION:
            locked_vacation_details.append(
                f"{request.nurse_id} {request.request_date}: expected VAC, "
                f"got {actual.value if actual else 'MISSING'}"
            )
        elif normalized.locked_shift is not None and actual != normalized.locked_shift:
            detail = (
                f"{request.nurse_id} {request.request_date}: expected "
                f"{normalized.locked_shift.value}, got {actual.value if actual else 'MISSING'}"
            )
            if normalized.locked_shift == ShiftCode.EDUCATION:
                locked_education_details.append(detail)
            else:
                locked_clinical_details.append(detail)
        if (
            normalized.constraint_mode == RequestConstraintMode.REQUIRED
            and normalized.allowed_assignments is not None
            and actual not in normalized.allowed_assignments
        ):
            allowed_text = ",".join(
                sorted(item.value for item in normalized.allowed_assignments)
            )
            required_assignment_details.append(
                f"{request.nurse_id} {request.request_date}: expected one of "
                f"{allowed_text}, got {actual.value if actual else 'MISSING'}"
            )
        if (
            normalized.constraint_mode == RequestConstraintMode.LOCKED
            and normalized.locked_shift is None
            and normalized.allowed_assignments is not None
            and actual not in normalized.allowed_assignments
        ):
            allowed = ",".join(
                sorted(item.value for item in normalized.allowed_assignments)
            )
            flexible_details.append(
                f"{request.nurse_id} {request.request_date}: expected one of {allowed}, "
                f"got {actual.value if actual else 'MISSING'}"
            )
    checks.extend(
        [
            _check(
                "NORMALIZATION_RESOLVED",
                "All request values are normalized or human-resolved",
                normalization_details,
            ),
            _check(
                "REQUEST_SEMANTICS",
                "Request values use the required constraint mode",
                request_semantics_details,
            ),
            _check(
                "OFF_PRIORITY_NORMALIZED",
                "OFF requests have an O1 through O4 priority",
                off_priority_details,
            ),
            _check(
                "VACATION_PRESERVED",
                "Approved Vacation is immutable",
                locked_vacation_details,
            ),
            _check(
                "EDUCATION_PRESERVED",
                "Admin-approved Education locks are preserved",
                locked_education_details,
            ),
            _check(
                "FIXED_CLINICAL_PRESERVED",
                "Admin-approved Day and Night locks are preserved",
                locked_clinical_details,
            ),
            _check(
                "REQUIRED_ASSIGNMENT_ALLOWED",
                "Required O/D and O/N choices stay inside their domain",
                required_assignment_details,
            ),
            _check(
                "FLEXIBLE_ASSIGNMENT_ALLOWED",
                "Admin-approved assignment sets are preserved",
                flexible_details,
            ),
        ]
    )

    def shift_at(nurse_id: str, assignment_date: date) -> ShiftCode | None:
        if assignment_date < problem.period_start:
            return previous_map.get((nurse_id, assignment_date))
        return assignment_map.get((nurse_id, assignment_date))

    consecutive_day_details: list[str] = []
    consecutive_night_details: list[str] = []
    consecutive_clinical_details: list[str] = []
    night_to_day_details: list[str] = []
    night_to_education_details: list[str] = []
    off_vacation_details: list[str] = []
    for nurse in problem.nurses:
        for current_date in dates:
            day_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(range(problem.rules.max_consecutive_day + 1))
            ]
            if all(shift_at(nurse.id, item) == ShiftCode.DAY for item in day_window):
                consecutive_day_details.append(
                    f"{nurse.id}: {day_window[0]} through {day_window[-1]} are all D"
                )

            night_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(range(problem.rules.max_consecutive_night + 1))
            ]
            if all(
                shift_at(nurse.id, item) == ShiftCode.NIGHT for item in night_window
            ):
                consecutive_night_details.append(
                    f"{nurse.id}: {night_window[0]} through {night_window[-1]} are all N"
                )

            clinical_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(
                    range(problem.rules.max_consecutive_clinical + 1)
                )
            ]
            if all(
                shift_at(nurse.id, item) in {ShiftCode.DAY, ShiftCode.NIGHT}
                for item in clinical_window
            ):
                consecutive_clinical_details.append(
                    f"{nurse.id}: {clinical_window[0]} through "
                    f"{clinical_window[-1]} are six clinical days"
                )

            previous_date = current_date - timedelta(days=1)
            if (
                shift_at(nurse.id, previous_date) == ShiftCode.NIGHT
                and shift_at(nurse.id, current_date) == ShiftCode.DAY
            ):
                night_to_day_details.append(
                    f"{nurse.id}: N on {previous_date} followed by D on {current_date}"
                )
            if (
                shift_at(nurse.id, previous_date) == ShiftCode.NIGHT
                and shift_at(nurse.id, current_date) == ShiftCode.EDUCATION
            ):
                night_to_education_details.append(
                    f"{nurse.id}: N on {previous_date} followed by ED on {current_date}"
                )

        off_window_size = problem.rules.max_consecutive_off_vacation + 1
        for window_start in range(0, len(dates) - off_window_size + 1):
            window = dates[window_start : window_start + off_window_size]
            if all(
                shift_at(nurse.id, item) in {ShiftCode.OFF, ShiftCode.VACATION}
                for item in window
            ):
                off_vacation_details.append(
                    f"{nurse.id}: {window[0]} through {window[-1]} are OFF/VAC"
                )
    checks.extend(
        [
            _check(
                "MAX_CONSECUTIVE_DAY",
                "No more than three consecutive Day shifts",
                consecutive_day_details,
            ),
            _check(
                "MAX_CONSECUTIVE_NIGHT",
                "No more than three consecutive Night shifts",
                consecutive_night_details,
            ),
            _check(
                "MAX_CONSECUTIVE_CLINICAL",
                "No more than five consecutive Day/Night shifts",
                consecutive_clinical_details,
            ),
            _check("NIGHT_TO_DAY", "Night may not be followed by Day", night_to_day_details),
            _check(
                "NIGHT_TO_EDUCATION",
                "Night may not be followed by Education",
                night_to_education_details,
            ),
            _check(
                "MAX_CONSECUTIVE_OFF_VACATION",
                "No more than seven consecutive OFF/Vacation days",
                off_vacation_details,
            ),
        ]
    )

    l0_details: list[str] = []
    l0_weekday_default_details: list[str] = []
    for nurse in problem.nurses:
        if nurse.skill_level != SkillLevel.MEMBER_L0:
            continue
        clinical_count = sum(
            assignment_map.get((nurse.id, assignment_date))
            in {ShiftCode.DAY, ShiftCode.NIGHT}
            for assignment_date in dates
        )
        if clinical_count > problem.rules.max_l0_clinical_shifts:
            l0_details.append(
                f"{nurse.id}: {clinical_count} clinical shifts exceeds "
                f"{problem.rules.max_l0_clinical_shifts}"
            )
        for assignment_date in dates:
            if assignment_date.weekday() >= 5:
                continue
            actual = assignment_map.get((nurse.id, assignment_date))
            if actual in {
                ShiftCode.DAY,
                ShiftCode.NIGHT,
                ShiftCode.EDUCATION,
            }:
                continue
            request = prepared_requests.get((nurse.id, assignment_date))
            allowed = request.allowed_assignments if request else None
            off_is_requested = bool(
                request
                and (
                    request.kind == RequestKind.OFF_REQUEST
                    or (
                        request.constraint_mode
                        in {RequestConstraintMode.LOCKED, RequestConstraintMode.REQUIRED}
                        and allowed
                        and ShiftCode.OFF in allowed
                    )
                )
            )
            vacation_is_locked = bool(
                request
                and request.constraint_mode == RequestConstraintMode.LOCKED
                and allowed == frozenset({ShiftCode.VACATION})
            )
            if actual == ShiftCode.OFF and off_is_requested:
                continue
            if actual == ShiftCode.VACATION and vacation_is_locked:
                continue
            l0_weekday_default_details.append(
                f"{nurse.id} {assignment_date}: expected D, N, ED, requested OFF, "
                f"or locked VAC; got {actual.value if actual else 'MISSING'}"
            )
    checks.extend(
        [
            _check(
                "MEMBER_L0_LIMIT",
                "Member L0 monthly clinical shift limit",
                l0_details,
            ),
            _check(
                "MEMBER_L0_WEEKDAY_DEFAULT",
                "Member L0 uses Education when not clinical on weekdays",
                l0_weekday_default_details,
            ),
        ]
    )

    long_off_details: list[str] = []
    for block in find_long_off_blocks(prepared_requests):
        missed_off_dates = [
            request_date
            for request_date in block.off_dates
            if assignment_map.get((block.nurse_id, request_date)) != ShiftCode.OFF
        ]
        if len(missed_off_dates) > 1:
            long_off_details.append(
                f"{block.nurse_id} {block.dates[0]} through {block.dates[-1]}: "
                f"{len(missed_off_dates)} requested OFF days were changed"
            )
    checks.append(
        _check(
            "LONG_OFF_BLOCK_PRESERVED",
            "Long requested OFF/VAC blocks lose at most one OFF day",
            long_off_details,
        )
    )

    return ValidationReport(
        is_valid=all(check.status == "PASS" for check in checks),
        checks=checks,
    )
