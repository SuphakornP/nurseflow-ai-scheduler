from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum

from .models import DailyRequest, ShiftCode


class NormalizationStatus(str, Enum):
    NORMALIZED = "NORMALIZED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class RequestKind(str, Enum):
    AVAILABLE = "AVAILABLE"
    FIXED = "FIXED"
    OFF_REQUEST = "OFF_REQUEST"
    FLEXIBLE = "FLEXIBLE"
    RESOLVED = "RESOLVED"
    AMBIGUOUS = "AMBIGUOUS"


@dataclass(frozen=True)
class NormalizedRequest:
    raw_value: str
    canonical_value: str
    status: NormalizationStatus
    kind: RequestKind
    allowed_assignments: frozenset[ShiftCode] | None = None
    locked_shift: ShiftCode | None = None
    off_priority: int | None = None
    note: str | None = None


def canonicalize(raw_value: str) -> str:
    normalized = unicodedata.normalize("NFKC", raw_value or "").strip().upper()
    return re.sub(r"\s+", "", normalized)


def parse_date_value(value: date | datetime | str) -> date:
    """Parse common Sheet/Excel date values, including Thai Buddhist years."""

    if isinstance(value, datetime):
        parsed = value.date()
    elif isinstance(value, date):
        parsed = value
    else:
        text = unicodedata.normalize("NFKC", value).strip()
        parsed = None
        for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
            try:
                parsed = datetime.strptime(text, pattern).date()
                break
            except ValueError:
                continue
        if parsed is None:
            raise ValueError(f"Unsupported date value: {value}")
    if parsed.year >= 2400:
        parsed = parsed.replace(year=parsed.year - 543)
    return parsed


def normalize_request(request: DailyRequest) -> NormalizedRequest:
    raw_value = request.raw_value or ""
    canonical = canonicalize(raw_value)

    if request.resolution is not None:
        resolution = request.resolution
        allowed = (
            frozenset(resolution.allowed_assignments)
            if resolution.allowed_assignments
            else None
        )
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.RESOLVED,
            allowed_assignments=allowed,
            locked_shift=resolution.locked_shift,
            off_priority=resolution.off_priority,
            note="Human-approved resolution",
        )

    if canonical in {"", "AVAILABLE", "A"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.AVAILABLE,
        )

    fixed_aliases = {
        "D": ShiftCode.DAY,
        "DAY": ShiftCode.DAY,
        "N": ShiftCode.NIGHT,
        "NIGHT": ShiftCode.NIGHT,
        "VAC": ShiftCode.VACATION,
        "VACATION": ShiftCode.VACATION,
        "ED": ShiftCode.EDUCATION,
        "\u0e0aED": ShiftCode.EDUCATION,
        "\u0e2d\u0e1a\u0e23\u0e21": ShiftCode.EDUCATION,
    }
    if canonical in fixed_aliases:
        shift = fixed_aliases[canonical]
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.FIXED,
            allowed_assignments=frozenset({shift}),
            locked_shift=shift,
        )

    off_match = re.fullmatch(r"O([1-4])", canonical)
    if off_match:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.OFF_REQUEST,
            off_priority=int(off_match.group(1)),
        )

    if canonical in {"O/D", "D/O", "OFF/D", "D/OFF"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value="O/D",
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.FLEXIBLE,
            allowed_assignments=frozenset({ShiftCode.OFF, ShiftCode.DAY}),
        )

    if canonical in {"O/N", "N/O", "OFF/N", "N/OFF"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value="O/N",
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.FLEXIBLE,
            allowed_assignments=frozenset({ShiftCode.OFF, ShiftCode.NIGHT}),
        )

    ambiguous = {"O1/N", "O2/N", "O3/N", "O4/N", "D/N", "D1", "VAC1"}
    note = (
        "Known ambiguous notation; provide an explicit resolution"
        if canonical in ambiguous
        else "Unknown notation; provide an explicit resolution"
    )
    return NormalizedRequest(
        raw_value=raw_value,
        canonical_value=canonical,
        status=NormalizationStatus.NEEDS_REVIEW,
        kind=RequestKind.AMBIGUOUS,
        note=note,
    )
