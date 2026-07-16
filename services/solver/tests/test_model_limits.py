from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import (
    MAX_NURSES,
    MAX_PERIOD_DAYS,
    MAX_RAW_REQUEST_LENGTH,
    MAX_SCHEDULE_ENTRIES,
    MAX_STAFFING_PER_SHIFT,
    DailyRequest,
    ExportRequest,
    RequestResolution,
    ScheduleProblem,
    ScheduleRules,
    ShiftCode,
    StaffingRange,
)


def _nurse(index: int) -> dict[str, str]:
    return {
        "id": f"nurse-{index}",
        "nickname": f"Nurse {index}",
        "skill_level": "INCHARGE",
    }


def _problem_payload() -> dict[str, object]:
    return {
        "period_start": "2026-08-01",
        "period_end": "2026-08-31",
        "nurses": [_nurse(0)],
    }


def _assert_limit_error(error: ValidationError, field: str) -> None:
    assert any(
        item["loc"] == (field,)
        and item["type"] in {"less_than_equal", "string_too_long", "too_long"}
        for item in error.errors()
    )


def test_schedule_problem_rejects_too_many_nurses() -> None:
    payload = _problem_payload()
    payload["nurses"] = [_nurse(index) for index in range(MAX_NURSES + 1)]

    with pytest.raises(ValidationError) as exc_info:
        ScheduleProblem.model_validate(payload)

    _assert_limit_error(exc_info.value, "nurses")


def test_schedule_problem_rejects_too_many_requests() -> None:
    payload = _problem_payload()
    request = {
        "nurse_id": "nurse-0",
        "request_date": "2026-08-01",
        "raw_value": "OFF",
    }
    payload["requests"] = [request] * (MAX_SCHEDULE_ENTRIES + 1)

    with pytest.raises(ValidationError) as exc_info:
        ScheduleProblem.model_validate(payload)

    _assert_limit_error(exc_info.value, "requests")


def test_schedule_problem_rejects_too_many_previous_assignments() -> None:
    payload = _problem_payload()
    previous = {
        "nurse_id": "nurse-0",
        "assignment_date": "2026-07-31",
        "shift": "OFF",
    }
    payload["previous_assignments"] = [previous] * (MAX_SCHEDULE_ENTRIES + 1)

    with pytest.raises(ValidationError) as exc_info:
        ScheduleProblem.model_validate(payload)

    _assert_limit_error(exc_info.value, "previous_assignments")


def test_export_request_rejects_too_many_assignments() -> None:
    problem = ScheduleProblem.model_validate(_problem_payload())
    assignment = {
        "nurse_id": "nurse-0",
        "nickname": "Nurse 0",
        "skill_level": "INCHARGE",
        "assignment_date": "2026-08-01",
        "shift": "OFF",
    }

    with pytest.raises(ValidationError) as exc_info:
        ExportRequest(
            problem=problem,
            assignments=[assignment] * (MAX_SCHEDULE_ENTRIES + 1),
        )

    _assert_limit_error(exc_info.value, "assignments")


def test_request_resolution_rejects_more_than_known_shift_codes() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RequestResolution(
            allowed_assignments=[
                ShiftCode.DAY,
                ShiftCode.NIGHT,
                ShiftCode.OFF,
                ShiftCode.VACATION,
                ShiftCode.EDUCATION,
                ShiftCode.OFF,
            ]
        )

    _assert_limit_error(exc_info.value, "allowed_assignments")


def test_daily_request_rejects_oversized_raw_value() -> None:
    with pytest.raises(ValidationError) as exc_info:
        DailyRequest(
            nurse_id="nurse-0",
            request_date="2026-08-01",
            raw_value="x" * (MAX_RAW_REQUEST_LENGTH + 1),
        )

    _assert_limit_error(exc_info.value, "raw_value")


@pytest.mark.parametrize("field", ["minimum", "maximum"])
def test_staffing_range_rejects_values_above_nurse_limit(field: str) -> None:
    payload = {"minimum": 0, "maximum": MAX_STAFFING_PER_SHIFT}
    payload[field] = MAX_STAFFING_PER_SHIFT + 1

    with pytest.raises(ValidationError) as exc_info:
        StaffingRange.model_validate(payload)

    _assert_limit_error(exc_info.value, field)


@pytest.mark.parametrize(
    "field",
    [
        "day_staffing",
        "night_staffing",
    ],
)
def test_schedule_rules_reject_extreme_staffing_counts(field: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        ScheduleRules.model_validate({field: MAX_STAFFING_PER_SHIFT + 1})

    _assert_limit_error(exc_info.value, field)


@pytest.mark.parametrize(
    "field",
    [
        "max_consecutive_day",
        "max_consecutive_night",
        "max_consecutive_clinical",
        "max_consecutive_off_vacation",
        "max_l0_clinical_shifts",
    ],
)
def test_schedule_rules_reject_sequences_longer_than_period_limit(field: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        ScheduleRules.model_validate({field: MAX_PERIOD_DAYS + 1})

    _assert_limit_error(exc_info.value, field)


def test_rule_limits_accept_the_documented_maxima() -> None:
    staffing_range = StaffingRange(
        minimum=MAX_STAFFING_PER_SHIFT,
        maximum=MAX_STAFFING_PER_SHIFT,
    )
    rules = ScheduleRules(
        day_staffing=MAX_STAFFING_PER_SHIFT,
        night_staffing=MAX_STAFFING_PER_SHIFT,
        max_consecutive_day=MAX_PERIOD_DAYS,
        max_consecutive_night=MAX_PERIOD_DAYS,
        max_consecutive_clinical=MAX_PERIOD_DAYS,
        max_consecutive_off_vacation=MAX_PERIOD_DAYS,
        max_l0_clinical_shifts=MAX_PERIOD_DAYS,
    )

    assert staffing_range.maximum == MAX_STAFFING_PER_SHIFT
    assert rules.day_staffing == MAX_STAFFING_PER_SHIFT
    assert rules.max_consecutive_clinical == MAX_PERIOD_DAYS
