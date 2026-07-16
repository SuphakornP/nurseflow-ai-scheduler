from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from time import perf_counter
from typing import Iterable

from ortools.sat.python import cp_model

from .models import (
    Assignment,
    DailyCoverage,
    GenerateResponse,
    Nurse,
    NurseSummary,
    OptimizationProfile,
    PhaseResult,
    ScheduleProblem,
    ShiftCode,
    SkillLevel,
)
from .normalization import (
    NormalizationStatus,
    NormalizedRequest,
    RequestKind,
    normalize_request,
)
from .validation import validate_schedule


ALL_SHIFTS = tuple(ShiftCode)
CLINICAL_SHIFTS = (ShiftCode.DAY, ShiftCode.NIGHT)


class InputProblemError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    variables: dict[tuple[str, date, ShiftCode], cp_model.IntVar]
    off_requests: dict[int, list[cp_model.IntVar]]
    off_adjacencies: list[cp_model.IntVar]
    fairness_spreads: list[cp_model.IntVar]
    weekend_spreads: list[cp_model.IntVar]
    l0_clinical: list[cp_model.IntVar]
    l0_weekday_education: list[cp_model.IntVar]


def period_dates(problem: ScheduleProblem) -> list[date]:
    return [
        problem.period_start + timedelta(days=offset)
        for offset in range((problem.period_end - problem.period_start).days + 1)
    ]


def prepare_requests(
    problem: ScheduleProblem,
) -> dict[tuple[str, date], NormalizedRequest]:
    prepared: dict[tuple[str, date], NormalizedRequest] = {}
    errors: list[str] = []
    for request in problem.requests:
        normalized = normalize_request(request)
        if normalized.status == NormalizationStatus.NEEDS_REVIEW:
            errors.append(
                f"{request.nurse_id} {request.request_date}: "
                f"'{request.raw_value}' needs review"
            )
        prepared[(request.nurse_id, request.request_date)] = normalized
    if errors:
        raise InputProblemError(errors)
    return prepared


def _preflight(problem: ScheduleProblem) -> None:
    errors: list[str] = []
    if len(problem.nurses) < problem.rules.day_staffing + problem.rules.night_staffing:
        errors.append("Not enough nurses to cover Day and Night on the same date")

    counts: dict[SkillLevel, int] = defaultdict(int)
    for nurse in problem.nurses:
        counts[nurse.skill_level] += 1
    for level, staffing_range in problem.rules.skill_ranges.items():
        required_each_day = staffing_range.minimum * 2
        if counts[level] < required_each_day:
            errors.append(
                f"{level.value} has {counts[level]} nurses but needs at least "
                f"{required_each_day} across Day and Night"
            )

    minimum_per_shift = sum(
        item.minimum for item in problem.rules.skill_ranges.values()
    )
    maximum_per_shift = sum(
        item.maximum for item in problem.rules.skill_ranges.values()
    )
    for label, target in (
        ("Day", problem.rules.day_staffing),
        ("Night", problem.rules.night_staffing),
    ):
        if not minimum_per_shift <= target <= maximum_per_shift:
            errors.append(
                f"{label} staffing target {target} is outside combined skill bounds "
                f"{minimum_per_shift}..{maximum_per_shift}"
            )
    if errors:
        raise InputProblemError(errors)


def _sum(items: Iterable[cp_model.LinearExpr | int]) -> cp_model.LinearExpr | int:
    materialized = list(items)
    return sum(materialized) if materialized else 0


def _build_model(
    problem: ScheduleProblem,
    prepared_requests: dict[tuple[str, date], NormalizedRequest],
) -> BuiltModel:
    model = cp_model.CpModel()
    dates = period_dates(problem)
    nurses_by_level: dict[SkillLevel, list[Nurse]] = defaultdict(list)
    for nurse in problem.nurses:
        nurses_by_level[nurse.skill_level].append(nurse)

    variables: dict[tuple[str, date, ShiftCode], cp_model.IntVar] = {}
    for nurse in problem.nurses:
        for assignment_date in dates:
            for shift in ALL_SHIFTS:
                variables[(nurse.id, assignment_date, shift)] = model.NewBoolVar(
                    f"x_{nurse.id}_{assignment_date.isoformat()}_{shift.value}"
                )

    off_requests: dict[int, list[cp_model.IntVar]] = defaultdict(list)
    l0_weekday_education: list[cp_model.IntVar] = []
    for nurse in problem.nurses:
        for assignment_date in dates:
            request = prepared_requests.get((nurse.id, assignment_date))
            allowed = {ShiftCode.DAY, ShiftCode.NIGHT, ShiftCode.OFF}
            if (
                nurse.skill_level == SkillLevel.MEMBER_L0
                and assignment_date.weekday() < 5
            ):
                allowed.add(ShiftCode.EDUCATION)
                l0_weekday_education.append(
                    variables[(nurse.id, assignment_date, ShiftCode.EDUCATION)]
                )

            if request is not None:
                if request.locked_shift is not None:
                    allowed = {request.locked_shift}
                elif request.allowed_assignments is not None:
                    allowed = set(request.allowed_assignments)
                if request.off_priority is not None:
                    off_requests[request.off_priority].append(
                        variables[(nurse.id, assignment_date, ShiftCode.OFF)]
                    )

            model.Add(
                _sum(variables[(nurse.id, assignment_date, shift)] for shift in ALL_SHIFTS)
                == 1
            )
            for shift in ALL_SHIFTS:
                if shift not in allowed:
                    model.Add(variables[(nurse.id, assignment_date, shift)] == 0)

    for assignment_date in dates:
        for shift, target in (
            (ShiftCode.DAY, problem.rules.day_staffing),
            (ShiftCode.NIGHT, problem.rules.night_staffing),
        ):
            model.Add(
                _sum(
                    variables[(nurse.id, assignment_date, shift)]
                    for nurse in problem.nurses
                )
                == target
            )
            for level, staffing_range in problem.rules.skill_ranges.items():
                level_count = _sum(
                    variables[(nurse.id, assignment_date, shift)]
                    for nurse in nurses_by_level[level]
                )
                model.Add(level_count >= staffing_range.minimum)
                model.Add(level_count <= staffing_range.maximum)

            incharge_and_trainee = _sum(
                variables[(nurse.id, assignment_date, shift)]
                for level in (SkillLevel.INCHARGE, SkillLevel.TRAINEE_INC)
                for nurse in nurses_by_level[level]
            )
            member_l2 = _sum(
                variables[(nurse.id, assignment_date, shift)]
                for nurse in nurses_by_level[SkillLevel.MEMBER_L2]
            )
            minimum_skill_mix = model.NewBoolVar(
                f"minimum_skill_mix_{assignment_date.isoformat()}_{shift.value}"
            )
            model.Add(incharge_and_trainee == 3).OnlyEnforceIf(minimum_skill_mix)
            model.Add(incharge_and_trainee >= 4).OnlyEnforceIf(
                minimum_skill_mix.Not()
            )
            model.Add(member_l2 <= 2).OnlyEnforceIf(minimum_skill_mix)

    previous = {
        (item.nurse_id, item.assignment_date): item.shift
        for item in problem.previous_assignments
    }

    def expression_for(
        nurse_id: str, assignment_date: date, shift: ShiftCode
    ) -> cp_model.IntVar | int:
        if problem.period_start <= assignment_date <= problem.period_end:
            return variables[(nurse_id, assignment_date, shift)]
        return int(previous.get((nurse_id, assignment_date)) == shift)

    def clinical_expression(nurse_id: str, assignment_date: date) -> cp_model.LinearExpr:
        return _sum(
            expression_for(nurse_id, assignment_date, shift)
            for shift in CLINICAL_SHIFTS
        )

    for nurse in problem.nurses:
        # Previous context is applied to D, N, D+N and transition rules. Missing
        # historical dates break a sequence rather than being guessed.
        for current_date in dates:
            day_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(range(problem.rules.max_consecutive_day + 1))
            ]
            model.Add(
                _sum(
                    expression_for(nurse.id, item, ShiftCode.DAY)
                    for item in day_window
                )
                <= problem.rules.max_consecutive_day
            )

            night_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(range(problem.rules.max_consecutive_night + 1))
            ]
            model.Add(
                _sum(
                    expression_for(nurse.id, item, ShiftCode.NIGHT)
                    for item in night_window
                )
                <= problem.rules.max_consecutive_night
            )

            clinical_window = [
                current_date - timedelta(days=offset)
                for offset in reversed(
                    range(problem.rules.max_consecutive_clinical + 1)
                )
            ]
            model.Add(
                _sum(clinical_expression(nurse.id, item) for item in clinical_window)
                <= problem.rules.max_consecutive_clinical
            )

            previous_date = current_date - timedelta(days=1)
            model.Add(
                expression_for(nurse.id, previous_date, ShiftCode.NIGHT)
                + expression_for(nurse.id, current_date, ShiftCode.DAY)
                <= 1
            )
            model.Add(
                expression_for(nurse.id, previous_date, ShiftCode.NIGHT)
                + expression_for(nurse.id, current_date, ShiftCode.EDUCATION)
                <= 1
            )

        off_window_size = problem.rules.max_consecutive_off_vacation + 1
        for window_start in range(0, len(dates) - off_window_size + 1):
            window = dates[window_start : window_start + off_window_size]
            model.Add(
                _sum(
                    variables[(nurse.id, item, ShiftCode.OFF)]
                    + variables[(nurse.id, item, ShiftCode.VACATION)]
                    for item in window
                )
                <= problem.rules.max_consecutive_off_vacation
            )

    l0_clinical: list[cp_model.IntVar] = []
    for nurse in nurses_by_level[SkillLevel.MEMBER_L0]:
        nurse_l0_clinical = [
            variables[(nurse.id, assignment_date, shift)]
            for assignment_date in dates
            for shift in CLINICAL_SHIFTS
        ]
        l0_clinical.extend(nurse_l0_clinical)
        model.Add(
            _sum(nurse_l0_clinical) <= problem.rules.max_l0_clinical_shifts
        )

    off_adjacencies: list[cp_model.IntVar] = []
    for nurse in problem.nurses:
        offish: dict[date, cp_model.IntVar] = {}
        for assignment_date in dates:
            value = model.NewBoolVar(
                f"offish_{nurse.id}_{assignment_date.isoformat()}"
            )
            model.Add(
                value
                == variables[(nurse.id, assignment_date, ShiftCode.OFF)]
                + variables[(nurse.id, assignment_date, ShiftCode.VACATION)]
            )
            offish[assignment_date] = value
        for left, right in zip(dates, dates[1:], strict=False):
            adjacent = model.NewBoolVar(
                f"off_pair_{nurse.id}_{left.isoformat()}_{right.isoformat()}"
            )
            model.Add(adjacent <= offish[left])
            model.Add(adjacent <= offish[right])
            model.Add(adjacent >= offish[left] + offish[right] - 1)
            off_adjacencies.append(adjacent)

    fairness_spreads: list[cp_model.IntVar] = []
    weekend_spreads: list[cp_model.IntVar] = []
    for level, level_nurses in nurses_by_level.items():
        if len(level_nurses) < 2 or level == SkillLevel.MEMBER_L0:
            continue

        day_counts: list[cp_model.IntVar] = []
        night_counts: list[cp_model.IntVar] = []
        weekend_counts: list[cp_model.IntVar] = []
        for nurse in level_nurses:
            day_count = model.NewIntVar(0, len(dates), f"day_count_{nurse.id}")
            night_count = model.NewIntVar(0, len(dates), f"night_count_{nurse.id}")
            weekend_count = model.NewIntVar(
                0, len(dates), f"weekend_count_{nurse.id}"
            )
            model.Add(
                day_count
                == _sum(
                    variables[(nurse.id, assignment_date, ShiftCode.DAY)]
                    for assignment_date in dates
                )
            )
            model.Add(
                night_count
                == _sum(
                    variables[(nurse.id, assignment_date, ShiftCode.NIGHT)]
                    for assignment_date in dates
                )
            )
            model.Add(
                weekend_count
                == _sum(
                    variables[(nurse.id, assignment_date, shift)]
                    for assignment_date in dates
                    if assignment_date.weekday() in problem.rules.weekend_days
                    for shift in CLINICAL_SHIFTS
                )
            )
            day_counts.append(day_count)
            night_counts.append(night_count)
            weekend_counts.append(weekend_count)

        for label, counts_for_shift in (
            ("day", day_counts),
            ("night", night_counts),
        ):
            maximum = model.NewIntVar(0, len(dates), f"max_{label}_{level.value}")
            minimum = model.NewIntVar(0, len(dates), f"min_{label}_{level.value}")
            spread = model.NewIntVar(0, len(dates), f"spread_{label}_{level.value}")
            model.AddMaxEquality(maximum, counts_for_shift)
            model.AddMinEquality(minimum, counts_for_shift)
            model.Add(spread == maximum - minimum)
            fairness_spreads.append(spread)

        weekend_maximum = model.NewIntVar(
            0, len(dates), f"max_weekend_{level.value}"
        )
        weekend_minimum = model.NewIntVar(
            0, len(dates), f"min_weekend_{level.value}"
        )
        weekend_spread = model.NewIntVar(
            0, len(dates), f"spread_weekend_{level.value}"
        )
        model.AddMaxEquality(weekend_maximum, weekend_counts)
        model.AddMinEquality(weekend_minimum, weekend_counts)
        model.Add(weekend_spread == weekend_maximum - weekend_minimum)
        weekend_spreads.append(weekend_spread)

    return BuiltModel(
        model=model,
        variables=variables,
        off_requests=dict(off_requests),
        off_adjacencies=off_adjacencies,
        fairness_spreads=fairness_spreads,
        weekend_spreads=weekend_spreads,
        l0_clinical=l0_clinical,
        l0_weekday_education=l0_weekday_education,
    )


def _assignment_rows(
    problem: ScheduleProblem,
    built: BuiltModel,
    values: dict[tuple[str, date, ShiftCode], int],
) -> list[Assignment]:
    result: list[Assignment] = []
    for nurse in problem.nurses:
        for assignment_date in period_dates(problem):
            selected = [
                shift
                for shift in ALL_SHIFTS
                if values[(nurse.id, assignment_date, shift)] == 1
            ]
            if len(selected) != 1:
                continue
            result.append(
                Assignment(
                    nurse_id=nurse.id,
                    nickname=nurse.nickname,
                    skill_level=nurse.skill_level,
                    assignment_date=assignment_date,
                    shift=selected[0],
                )
            )
    return result


def summarize_assignments(
    problem: ScheduleProblem, assignments: list[Assignment]
) -> tuple[list[NurseSummary], list[DailyCoverage]]:
    assignment_map = {
        (item.nurse_id, item.assignment_date): item.shift for item in assignments
    }
    summaries: list[NurseSummary] = []
    for nurse in problem.nurses:
        counts = {shift: 0 for shift in ALL_SHIFTS}
        weekend_clinical = 0
        for assignment_date in period_dates(problem):
            shift = assignment_map.get((nurse.id, assignment_date))
            if shift is None:
                continue
            counts[shift] += 1
            if (
                assignment_date.weekday() in problem.rules.weekend_days
                and shift in CLINICAL_SHIFTS
            ):
                weekend_clinical += 1
        summaries.append(
            NurseSummary(
                nurse_id=nurse.id,
                nickname=nurse.nickname,
                skill_level=nurse.skill_level,
                day_count=counts[ShiftCode.DAY],
                night_count=counts[ShiftCode.NIGHT],
                off_count=counts[ShiftCode.OFF],
                vacation_count=counts[ShiftCode.VACATION],
                education_count=counts[ShiftCode.EDUCATION],
                clinical_shift_count=counts[ShiftCode.DAY]
                + counts[ShiftCode.NIGHT],
                weekend_clinical_count=weekend_clinical,
                total_hours=(counts[ShiftCode.DAY] + counts[ShiftCode.NIGHT]) * 12
                + counts[ShiftCode.EDUCATION] * 8,
            )
        )

    coverage: list[DailyCoverage] = []
    nurses_by_id = {nurse.id: nurse for nurse in problem.nurses}
    for assignment_date in period_dates(problem):
        day_skill_counts = {level: 0 for level in SkillLevel}
        night_skill_counts = {level: 0 for level in SkillLevel}
        day_count = 0
        night_count = 0
        for assignment in assignments:
            if assignment.assignment_date != assignment_date:
                continue
            level = nurses_by_id[assignment.nurse_id].skill_level
            if assignment.shift == ShiftCode.DAY:
                day_count += 1
                day_skill_counts[level] += 1
            elif assignment.shift == ShiftCode.NIGHT:
                night_count += 1
                night_skill_counts[level] += 1
        coverage.append(
            DailyCoverage(
                assignment_date=assignment_date,
                day_count=day_count,
                night_count=night_count,
                day_skill_counts=day_skill_counts,
                night_skill_counts=night_skill_counts,
            )
        )
    return summaries, coverage


def _metrics(
    problem: ScheduleProblem,
    prepared_requests: dict[tuple[str, date], NormalizedRequest],
    assignments: list[Assignment],
    summaries: list[NurseSummary],
) -> dict[str, int | float | str]:
    assignment_map = {
        (item.nurse_id, item.assignment_date): item.shift for item in assignments
    }
    metrics: dict[str, int | float | str] = {
        "OPTIMIZATION_PROFILE": problem.optimization_profile.value
    }
    total_off_requests = 0
    total_off_satisfied = 0
    for priority in range(1, 5):
        requests = [
            (key, value)
            for key, value in prepared_requests.items()
            if value.off_priority == priority
        ]
        satisfied = sum(
            assignment_map.get(key) == ShiftCode.OFF for key, _ in requests
        )
        metrics[f"O{priority}_REQUEST_COUNT"] = len(requests)
        metrics[f"O{priority}_SATISFIED_COUNT"] = satisfied
        metrics[f"O{priority}_SATISFACTION_RATE"] = (
            round(satisfied / len(requests), 4) if requests else 1.0
        )
        total_off_requests += len(requests)
        total_off_satisfied += satisfied
    metrics["OFF_SATISFACTION_RATE"] = (
        round(total_off_satisfied / total_off_requests, 4)
        if total_off_requests
        else 1.0
    )
    metrics["MEMBER_L0_USAGE"] = sum(
        item.clinical_shift_count
        for item in summaries
        if item.skill_level == SkillLevel.MEMBER_L0
    )
    metrics["TOTAL_ASSIGNMENTS"] = len(assignments)
    return metrics


def generate_schedule(problem: ScheduleProblem) -> GenerateResponse:
    started = perf_counter()
    _preflight(problem)
    prepared_requests = prepare_requests(problem)
    built = _build_model(problem, prepared_requests)

    phases: list[
        tuple[str, str, cp_model.LinearExpr | int, bool]
    ] = []
    for priority in range(1, 5):
        phase_values = built.off_requests.get(priority, [])
        if phase_values:
            phases.append(
                (f"MAXIMIZE_O{priority}", "MAXIMIZE", _sum(phase_values), True)
            )
    profile_weights = {
        OptimizationProfile.BALANCED: {
            "off_adjacency": 12,
            "l0_education": 2,
            "fairness": 45,
            "l0_clinical": 35,
            "weekend": 30,
        },
        OptimizationProfile.REQUESTS_FIRST: {
            "off_adjacency": 80,
            "l0_education": 2,
            "fairness": 10,
            "l0_clinical": 10,
            "weekend": 6,
        },
        OptimizationProfile.MINIMIZE_L0: {
            "off_adjacency": 10,
            "l0_education": 5,
            "fairness": 15,
            "l0_clinical": 300,
            "weekend": 8,
        },
    }[problem.optimization_profile]
    profile_score = (
        profile_weights["off_adjacency"] * _sum(built.off_adjacencies)
        + profile_weights["l0_education"] * _sum(built.l0_weekday_education)
        - profile_weights["fairness"] * _sum(built.fairness_spreads)
        - profile_weights["l0_clinical"] * _sum(built.l0_clinical)
        - profile_weights["weekend"] * _sum(built.weekend_spreads)
    )
    phases.append(
        (
            f"OPTIMIZE_PROFILE_{problem.optimization_profile.value.upper()}",
            "MAXIMIZE",
            profile_score,
            True,
        )
    )
    phases = [phase for phase in phases if phase[3]]

    phase_results: list[PhaseResult] = []
    last_values: dict[tuple[str, date, ShiftCode], int] | None = None
    last_status = cp_model.UNKNOWN
    time_per_phase = max(0.5, problem.time_limit_seconds / max(len(phases), 1))

    for name, direction, expression, _ in phases:
        if direction == "MAXIMIZE":
            built.model.Maximize(expression)
        else:
            built.model.Minimize(expression)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_per_phase
        # Parallel CP-SAT workers are necessary for the full 28x31 model to find
        # strong objective solutions inside an interactive showcase time budget.
        # The input and random seed remain fixed and every output is independently
        # validated before it can be returned as valid.
        solver.parameters.num_search_workers = 8
        solver.parameters.random_seed = problem.random_seed
        solver.parameters.log_search_progress = False
        status = solver.Solve(built.model)
        last_status = status
        if status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            if last_values is None:
                elapsed = int((perf_counter() - started) * 1000)
                return GenerateResponse(
                    status=solver.StatusName(status),
                    message="No feasible schedule was found within the configured limit",
                    phases=phase_results,
                    solver_duration_ms=elapsed,
                )
            break

        value = int(solver.Value(expression))
        phase_results.append(
            PhaseResult(
                name=name,
                direction=direction,
                status=solver.StatusName(status),
                value=value,
                proven_optimal=status == cp_model.OPTIMAL,
            )
        )
        last_values = {
            key: solver.Value(variable) for key, variable in built.variables.items()
        }
        # Freeze the best value found before moving to the next business priority.
        # FEASIBLE phases are reported as unproven rather than misrepresented as
        # globally optimal.
        built.model.Add(expression == value)

    if last_values is None:
        elapsed = int((perf_counter() - started) * 1000)
        return GenerateResponse(
            status=cp_model.CpSolver().StatusName(last_status),
            message="No feasible schedule was found",
            solver_duration_ms=elapsed,
        )

    assignments = _assignment_rows(problem, built, last_values)
    validation = validate_schedule(problem, assignments)
    summaries, daily_coverage = summarize_assignments(problem, assignments)
    metrics = _metrics(problem, prepared_requests, assignments, summaries)
    elapsed = int((perf_counter() - started) * 1000)
    all_optimal = phase_results and all(item.proven_optimal for item in phase_results)
    status_name = "OPTIMAL" if all_optimal else "FEASIBLE"
    if not validation.is_valid:
        status_name = "INVALID"
    return GenerateResponse(
        status=status_name,
        message=(
            "Schedule generated and independently validated"
            if validation.is_valid
            else "Solver returned assignments, but independent validation failed"
        ),
        assignments=assignments,
        summaries=summaries,
        daily_coverage=daily_coverage,
        metrics=metrics,
        phases=phase_results,
        validation=validation,
        solver_duration_ms=elapsed,
    )
