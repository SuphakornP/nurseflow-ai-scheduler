from datetime import date

import pytest

from app.models import DailyRequest, RequestResolution, ShiftCode
from app.normalization import (
    NormalizationStatus,
    RequestKind,
    normalize_request,
    parse_date_value,
)


@pytest.mark.parametrize("raw", ["Vac", " VAC ", "vac", "Vacation"])
def test_vacation_aliases_are_locked(raw: str) -> None:
    result = normalize_request(
        DailyRequest(nurse_id="A", request_date=date(2026, 8, 1), raw_value=raw)
    )
    assert result.status == NormalizationStatus.NORMALIZED
    assert result.locked_shift == ShiftCode.VACATION


@pytest.mark.parametrize("raw", ["ED", "ed", "\u0e0aED", " \u0e0aed "])
def test_education_aliases_are_locked(raw: str) -> None:
    result = normalize_request(
        DailyRequest(nurse_id="A", request_date=date(2026, 8, 1), raw_value=raw)
    )
    assert result.locked_shift == ShiftCode.EDUCATION


@pytest.mark.parametrize(
    ("raw", "allowed"),
    [
        ("O/D", {ShiftCode.OFF, ShiftCode.DAY}),
        ("D/O", {ShiftCode.OFF, ShiftCode.DAY}),
        ("O/N", {ShiftCode.OFF, ShiftCode.NIGHT}),
        ("N/O", {ShiftCode.OFF, ShiftCode.NIGHT}),
    ],
)
def test_flexible_aliases_have_strict_allowed_sets(
    raw: str, allowed: set[ShiftCode]
) -> None:
    result = normalize_request(
        DailyRequest(nurse_id="A", request_date=date(2026, 8, 1), raw_value=raw)
    )
    assert result.kind == RequestKind.FLEXIBLE
    assert result.allowed_assignments == frozenset(allowed)


@pytest.mark.parametrize("raw", ["O1/N", "D/N", "D1", "Vac1", "surprise"])
def test_ambiguous_values_require_review(raw: str) -> None:
    result = normalize_request(
        DailyRequest(nurse_id="A", request_date=date(2026, 8, 1), raw_value=raw)
    )
    assert result.status == NormalizationStatus.NEEDS_REVIEW


def test_human_resolution_unblocks_ambiguous_value() -> None:
    request = DailyRequest(
        nurse_id="A",
        request_date=date(2026, 8, 1),
        raw_value="O1/N",
        resolution=RequestResolution(
            allowed_assignments=[ShiftCode.OFF, ShiftCode.NIGHT],
            off_priority=1,
        ),
    )
    result = normalize_request(request)
    assert result.status == NormalizationStatus.NORMALIZED
    assert result.off_priority == 1
    assert result.allowed_assignments == frozenset(
        {ShiftCode.OFF, ShiftCode.NIGHT}
    )


def test_buddhist_year_is_converted_to_gregorian() -> None:
    assert parse_date_value("01/08/2569") == date(2026, 8, 1)
    assert parse_date_value("2026-08-01") == date(2026, 8, 1)
