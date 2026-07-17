from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .models import (
    Assignment,
    NurseSummary,
    RequestConstraintMode,
    ScheduleProblem,
    ShiftCode,
    ValidationReport,
)
from .normalization import normalize_request


NAVY = "17324D"
TEAL = "00A6A6"
PALE_TEAL = "DDF5F2"
PALE_BLUE = "E8F1F8"
PALE_YELLOW = "FFF4CC"
PALE_RED = "FDE8E7"
WHITE = "FFFFFF"
GRID = Side(style="thin", color="D7E0E8")


def _safe_text(value: str) -> str:
    # Excel-compatible readers may treat formula markers after leading whitespace
    # or control characters as executable content.
    if value.lstrip().startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def _header(cell, fill: str = NAVY) -> None:
    cell.fill = PatternFill("solid", fgColor=fill)
    cell.font = Font(color=WHITE, bold=True)
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = Border(left=GRID, right=GRID, top=GRID, bottom=GRID)


def _body(cell, fill: str | None = None, centered: bool = True) -> None:
    if isinstance(cell.value, str):
        cell.value = _safe_text(cell.value)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    cell.alignment = Alignment(
        horizontal="center" if centered else "left",
        vertical="center",
        wrap_text=True,
    )
    cell.border = Border(left=GRID, right=GRID, top=GRID, bottom=GRID)


def build_workbook(
    problem: ScheduleProblem,
    assignments: list[Assignment],
    summaries: list[NurseSummary],
    validation: ValidationReport,
) -> bytes:
    workbook = Workbook()
    schedule = workbook.active
    schedule.title = "Schedule"
    dates = [
        problem.period_start.fromordinal(problem.period_start.toordinal() + offset)
        for offset in range((problem.period_end - problem.period_start).days + 1)
    ]
    assignment_map = {
        (item.nurse_id, item.assignment_date): item.shift for item in assignments
    }

    schedule.merge_cells(start_row=1, start_column=1, end_row=1, end_column=3 + len(dates))
    title = schedule.cell(row=1, column=1, value=_safe_text(problem.period_name))
    title.fill = PatternFill("solid", fgColor=NAVY)
    title.font = Font(color=WHITE, bold=True, size=16)
    title.alignment = Alignment(horizontal="left", vertical="center")
    schedule.row_dimensions[1].height = 30

    headers = ["ID", "Nickname", "Skill Level"] + [
        item.strftime("%d %a") for item in dates
    ]
    for column, value in enumerate(headers, start=1):
        _header(schedule.cell(row=2, column=column, value=value))

    shift_fills = {
        ShiftCode.DAY: PALE_YELLOW,
        ShiftCode.NIGHT: PALE_BLUE,
        ShiftCode.OFF: "EEF1F4",
        ShiftCode.VACATION: PALE_TEAL,
        ShiftCode.EDUCATION: "F3EAFB",
    }
    for row, nurse in enumerate(problem.nurses, start=3):
        identity_values = [nurse.id, nurse.nickname, nurse.skill_level.value]
        for column, value in enumerate(identity_values, start=1):
            _body(schedule.cell(row=row, column=column, value=value), centered=False)
        for offset, assignment_date in enumerate(dates, start=4):
            shift = assignment_map.get((nurse.id, assignment_date))
            cell = schedule.cell(
                row=row,
                column=offset,
                value=shift.value if shift is not None else "",
            )
            _body(cell, fill=shift_fills.get(shift))
            cell.font = Font(bold=shift in {ShiftCode.DAY, ShiftCode.NIGHT})

    schedule.freeze_panes = "D3"
    schedule.auto_filter.ref = f"A2:{get_column_letter(3 + len(dates))}{2 + len(problem.nurses)}"
    schedule.column_dimensions["A"].width = 10
    schedule.column_dimensions["B"].width = 15
    schedule.column_dimensions["C"].width = 17
    for column in range(4, 4 + len(dates)):
        schedule.column_dimensions[get_column_letter(column)].width = 8
    schedule.sheet_view.showGridLines = False

    summary_sheet = workbook.create_sheet("Summary")
    summary_headers = [
        "ID",
        "Nickname",
        "Skill Level",
        "Day",
        "Night",
        "OFF",
        "Vacation",
        "Education",
        "Clinical Shifts",
        "Weekend Shifts",
        "Total Hours",
    ]
    for column, value in enumerate(summary_headers, start=1):
        _header(summary_sheet.cell(row=1, column=column, value=value), TEAL)
    for row, item in enumerate(summaries, start=2):
        values = [
            item.nurse_id,
            item.nickname,
            item.skill_level.value,
            item.day_count,
            item.night_count,
            item.off_count,
            item.vacation_count,
            item.education_count,
            item.clinical_shift_count,
            item.weekend_clinical_count,
            item.total_hours,
        ]
        for column, value in enumerate(values, start=1):
            _body(summary_sheet.cell(row=row, column=column, value=value))
    summary_sheet.freeze_panes = "A2"
    for column in range(1, len(summary_headers) + 1):
        summary_sheet.column_dimensions[get_column_letter(column)].width = 18
    summary_sheet.sheet_view.showGridLines = False

    validation_sheet = workbook.create_sheet("Validation")
    validation_headers = ["Constraint", "Name", "Status", "Violations", "Details"]
    for column, value in enumerate(validation_headers, start=1):
        _header(validation_sheet.cell(row=1, column=column, value=value), NAVY)
    for row, item in enumerate(validation.checks, start=2):
        values = [
            item.code,
            item.name,
            item.status,
            item.violation_count,
            "\n".join(item.details)[:32_000],
        ]
        fill = PALE_TEAL if item.status == "PASS" else PALE_RED
        for column, value in enumerate(values, start=1):
            _body(
                validation_sheet.cell(row=row, column=column, value=value),
                fill=fill,
                centered=column != 5,
            )
    validation_sheet.freeze_panes = "A2"
    validation_sheet.column_dimensions["A"].width = 34
    validation_sheet.column_dimensions["B"].width = 46
    validation_sheet.column_dimensions["C"].width = 12
    validation_sheet.column_dimensions["D"].width = 12
    validation_sheet.column_dimensions["E"].width = 90
    validation_sheet.sheet_view.showGridLines = False

    unfulfilled = workbook.create_sheet("Unfulfilled Requests")
    unfulfilled_headers = [
        "ID",
        "Nickname",
        "Date",
        "Request",
        "Priority",
        "Assigned",
    ]
    for column, value in enumerate(unfulfilled_headers, start=1):
        _header(unfulfilled.cell(row=1, column=column, value=value), TEAL)
    nurse_by_id = {nurse.id: nurse for nurse in problem.nurses}
    row = 2
    for request in sorted(problem.requests, key=lambda item: (item.request_date, item.nurse_id)):
        normalized = normalize_request(request)
        if (
            normalized.constraint_mode != RequestConstraintMode.PREFERENCE
            or not normalized.allowed_assignments
        ):
            continue
        assigned = assignment_map.get((request.nurse_id, request.request_date))
        if assigned in normalized.allowed_assignments:
            continue
        nurse = nurse_by_id[request.nurse_id]
        values = [
            nurse.id,
            nurse.nickname,
            request.request_date.isoformat(),
            request.raw_value,
            normalized.off_priority,
            assigned.value if assigned else "MISSING",
        ]
        for column, value in enumerate(values, start=1):
            _body(unfulfilled.cell(row=row, column=column, value=value))
        row += 1
    for column in range(1, len(unfulfilled_headers) + 1):
        unfulfilled.column_dimensions[get_column_letter(column)].width = 20
    unfulfilled.freeze_panes = "A2"
    unfulfilled.sheet_view.showGridLines = False

    metadata = workbook.create_sheet("Metadata")
    metadata_rows = [
        ("Period", problem.period_name),
        ("Start", problem.period_start.isoformat()),
        ("End", problem.period_end.isoformat()),
        ("Nurse count", len(problem.nurses)),
        ("Validation", "PASS" if validation.is_valid else "FAIL"),
        ("Random seed", problem.random_seed),
        ("PII policy", "Nickname and pseudonymous internal ID only"),
    ]
    for row, (label, value) in enumerate(metadata_rows, start=1):
        _header(metadata.cell(row=row, column=1, value=label), NAVY)
        _body(metadata.cell(row=row, column=2, value=value), centered=False)
    metadata.column_dimensions["A"].width = 24
    metadata.column_dimensions["B"].width = 58
    metadata.sheet_view.showGridLines = False

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
