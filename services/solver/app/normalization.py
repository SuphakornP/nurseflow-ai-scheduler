from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum

from .models import DailyRequest, RequestConstraintMode, ShiftCode, SkillLevel


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
    constraint_mode: RequestConstraintMode
    allowed_assignments: frozenset[ShiftCode] | None = None
    locked_shift: ShiftCode | None = None
    off_priority: int | None = None
    note: str | None = None


@dataclass(frozen=True)
class RequestedOffBlock:
    """A maximal contiguous run of explicit OFF requests and locked Vacation."""

    nurse_id: str
    dates: tuple[date, ...]
    off_dates: tuple[date, ...]
    vacation_dates: tuple[date, ...]


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
            else (
                frozenset({resolution.locked_shift})
                if resolution.locked_shift is not None
                else None
            )
        )
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.RESOLVED,
            constraint_mode=request.constraint_mode,
            allowed_assignments=allowed,
            locked_shift=(
                resolution.locked_shift
                if request.constraint_mode == RequestConstraintMode.LOCKED
                else None
            ),
            off_priority=resolution.off_priority,
            note="Human-approved resolution",
        )

    if canonical in {"", "AVAILABLE", "A"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.AVAILABLE,
            constraint_mode=request.constraint_mode,
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
            constraint_mode=request.constraint_mode,
            allowed_assignments=frozenset({shift}),
            locked_shift=(
                shift
                if request.constraint_mode == RequestConstraintMode.LOCKED
                else None
            ),
        )

    off_match = re.fullmatch(r"O([1-4])", canonical)
    if off_match or canonical in {"O", "OFF"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value=canonical,
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.OFF_REQUEST,
            constraint_mode=request.constraint_mode,
            allowed_assignments=frozenset({ShiftCode.OFF}),
            off_priority=int(off_match.group(1)) if off_match else 4,
        )

    if canonical in {"O/D", "D/O", "OFF/D", "D/OFF"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value="O/D",
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.FLEXIBLE,
            constraint_mode=request.constraint_mode,
            allowed_assignments=frozenset({ShiftCode.OFF, ShiftCode.DAY}),
        )

    if canonical in {"O/N", "N/O", "OFF/N", "N/OFF"}:
        return NormalizedRequest(
            raw_value=raw_value,
            canonical_value="O/N",
            status=NormalizationStatus.NORMALIZED,
            kind=RequestKind.FLEXIBLE,
            constraint_mode=request.constraint_mode,
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
        constraint_mode=request.constraint_mode,
        note=note,
    )


def request_semantics_error(
    normalized: NormalizedRequest,
    skill_level: SkillLevel,
) -> str | None:
    """Return a business-contract error for an unsupported mode/value pairing."""

    allowed = normalized.allowed_assignments or frozenset()
    if allowed == frozenset({ShiftCode.VACATION}):
        if normalized.constraint_mode != RequestConstraintMode.LOCKED:
            return "Vacation must use LOCKED mode"
        return None

    if allowed == frozenset({ShiftCode.EDUCATION}):
        if normalized.constraint_mode == RequestConstraintMode.LOCKED:
            return None
        if (
            skill_level == SkillLevel.MEMBER_L0
            and normalized.constraint_mode == RequestConstraintMode.PREFERENCE
        ):
            return None
        return "Education must be LOCKED for ordinary staff or PREFERENCE for Member L0"

    if normalized.kind == RequestKind.FLEXIBLE:
        if normalized.constraint_mode not in {
            RequestConstraintMode.REQUIRED,
            RequestConstraintMode.LOCKED,
        }:
            return "O/D and O/N must use REQUIRED mode"
        return None

    if (
        normalized.constraint_mode == RequestConstraintMode.REQUIRED
        and normalized.kind != RequestKind.RESOLVED
    ):
        return "REQUIRED mode needs O/D, O/N, or an explicit human resolution"
    return None


def find_long_off_blocks(
    prepared_requests: dict[tuple[str, date], NormalizedRequest],
    *,
    minimum_length: int = 5,
) -> list[RequestedOffBlock]:
    """Find maximal requested OFF/locked-VAC runs subject to the one-cut rule."""

    requested: dict[str, list[tuple[date, bool]]] = defaultdict(list)
    for (nurse_id, request_date), normalized in prepared_requests.items():
        allowed = normalized.allowed_assignments or frozenset()
        is_off = (
            normalized.kind == RequestKind.OFF_REQUEST
            and allowed == frozenset({ShiftCode.OFF})
        )
        is_vacation = (
            normalized.constraint_mode == RequestConstraintMode.LOCKED
            and allowed == frozenset({ShiftCode.VACATION})
        )
        if is_off or is_vacation:
            requested[nurse_id].append((request_date, is_vacation))

    blocks: list[RequestedOffBlock] = []
    for nurse_id, values in requested.items():
        current: list[tuple[date, bool]] = []

        def finish() -> None:
            if len(current) < minimum_length:
                return
            blocks.append(
                RequestedOffBlock(
                    nurse_id=nurse_id,
                    dates=tuple(item[0] for item in current),
                    off_dates=tuple(item[0] for item in current if not item[1]),
                    vacation_dates=tuple(item[0] for item in current if item[1]),
                )
            )

        for request_date, is_vacation in sorted(values):
            if current and request_date != current[-1][0] + timedelta(days=1):
                finish()
                current = []
            current.append((request_date, is_vacation))
        finish()
    return blocks
