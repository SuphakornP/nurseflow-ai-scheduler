import "server-only";

import { getConfirmationEligibility } from "@/lib/confirmation-eligibility";
import { datasetToSolverProblem } from "@/lib/solver-adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GenerateScheduleResponse, ScheduleVersion } from "@/lib/types";

interface StagedPeriod {
  id: string;
  department_id: string;
  code: string;
  status: string;
}

interface PeriodEmployee {
  id: string;
  nickname_snapshot: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Supabase returned an unexpected RPC result.");
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Supabase RPC result is missing ${key}.`);
  }
  return value;
}

function metricRows(version: ScheduleVersion) {
  const percentage = (value: number) => value / 100;
  return [
    { metric_code: "REQUEST_SATISFACTION_RATE", metric_value: percentage(version.metrics.requestSatisfactionRate) },
    { metric_code: "OFF_SATISFACTION_RATE", metric_value: percentage(version.metrics.offSatisfactionRate) },
    { metric_code: "O1_SATISFACTION_RATE", metric_value: percentage(version.metrics.o1SatisfactionRate) },
    { metric_code: "DAY_BALANCE_SCORE", metric_value: percentage(version.metrics.dayBalanceScore) },
    { metric_code: "NIGHT_BALANCE_SCORE", metric_value: percentage(version.metrics.nightBalanceScore) },
    { metric_code: "WEEKEND_BALANCE_SCORE", metric_value: percentage(version.metrics.weekendBalanceScore) },
    { metric_code: "MEMBER_L0_USAGE", metric_value: version.metrics.memberL0Usage },
    { metric_code: "HARD_CONSTRAINTS_PASSED", metric_value: version.metrics.hardConstraintsPassed },
    { metric_code: "HARD_CONSTRAINTS_TOTAL", metric_value: version.metrics.hardConstraintsTotal },
    { metric_code: "LOCKED_REQUIREMENTS_PASSED", metric_value: version.metrics.lockedRequirementsPassed },
    { metric_code: "LOCKED_REQUIREMENTS_TOTAL", metric_value: version.metrics.lockedRequirementsTotal },
    { metric_code: "REQUIRED_CHOICES_PASSED", metric_value: version.metrics.requiredChoicesPassed },
    { metric_code: "REQUIRED_CHOICES_TOTAL", metric_value: version.metrics.requiredChoicesTotal },
  ].map((metric) => ({ ...metric, metric_detail: {} }));
}

export async function persistAndConfirmSchedule(
  schedule: GenerateScheduleResponse,
  version: ScheduleVersion,
  actorNickname: string,
) {
  if (version.solverStatus !== "OPTIMAL" && version.solverStatus !== "FEASIBLE") {
    throw new Error("Only a live OPTIMAL or FEASIBLE solver result can be persisted.");
  }
  const eligibility = getConfirmationEligibility(version);
  if (!eligibility.eligible) {
    throw new Error("Only an eligible version with complete hard-validation evidence can be persisted.");
  }

  const supabase = createAdminClient();
  const { data: periodData, error: periodError } = await supabase
    .from("schedule_periods")
    .select("id, department_id, code, status")
    .eq("code", schedule.dataset.period.code)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();
  if (periodError || !periodData) {
    throw new Error(
      `Scheduling period ${schedule.dataset.period.code} is not staged in Supabase: ${periodError?.message ?? "not found"}`,
    );
  }
  const period = periodData as StagedPeriod;

  const { data: employeeData, error: employeeError } = await supabase
    .from("schedule_period_employees")
    .select("id, nickname_snapshot")
    .eq("schedule_period_id", period.id)
    .eq("department_id", period.department_id)
    .eq("is_available_for_period", true)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (employeeError || !employeeData) {
    throw new Error(`Unable to load period employees: ${employeeError?.message ?? "not found"}`);
  }

  const periodEmployees = employeeData as PeriodEmployee[];
  const periodEmployeeByNickname = new Map(
    periodEmployees.map((employee) => [employee.nickname_snapshot.trim().toLocaleLowerCase("en"), employee.id]),
  );
  const periodEmployeeByNurseId = new Map(
    schedule.dataset.nurses.map((nurse) => {
      const periodEmployeeId = periodEmployeeByNickname.get(
        nurse.nickname.trim().toLocaleLowerCase("en"),
      );
      if (!periodEmployeeId) {
        throw new Error(`Nickname ${nurse.nickname} is not staged for ${period.code}.`);
      }
      return [nurse.id, periodEmployeeId];
    }),
  );
  if (periodEmployeeByNurseId.size !== periodEmployees.length) {
    throw new Error(
      `The staged period has ${periodEmployees.length} employees but the solver returned ${periodEmployeeByNurseId.size}.`,
    );
  }

  const generatedAt = new Date().toISOString();
  const payload = {
    department_id: period.department_id,
    schedule_period_id: period.id,
    version: {
      name: version.name,
      parent_version_id: null,
      generation_type: version.versionNo === 1 ? "INITIAL" : "REGENERATE",
      solver_status: version.solverStatus,
      objective_score: version.objectiveScore ?? null,
      solver_duration_ms: null,
      constraint_config: { source: "nurseflow-cp-sat", ui_version_no: version.versionNo },
      generation_instruction: null,
      generation_summary: {
        source_version_id: version.id,
        privacy_mode: schedule.dataset.privacyMode,
        source_workbook_hash: schedule.dataset.sourceWorkbookHash ?? null,
        rejected_request_count: version.requestOutcomes.filter((outcome) => !outcome.satisfied).length,
        requested_by_nickname: actorNickname,
        solver_problem: datasetToSolverProblem(schedule.dataset, "balanced"),
      },
    },
    assignments: version.assignments.map((assignment) => ({
      period_employee_id: periodEmployeeByNurseId.get(assignment.nurseId),
      assignment_date: assignment.date,
      shift_code: assignment.shift,
      assignment_source: assignment.source,
      is_manual_override: assignment.source === "MANUAL",
      override_reason: null,
    })),
    validations: version.validations.map((validation) => ({
      constraint_code: validation.code,
      validation_status: validation.status,
      violation_count: validation.violationCount,
      validation_details: validation.details,
      validated_at: generatedAt,
    })),
    metrics: metricRows(version),
  };

  const { data: savedData, error: saveError } = await supabase.rpc(
    "save_schedule_candidate",
    { p_payload: payload },
  );
  if (saveError) throw new Error(`Unable to save schedule candidate: ${saveError.message}`);
  const saved = asRecord(savedData);
  const persistedVersionId = requireString(saved, "schedule_version_id");

  const { data: confirmedData, error: confirmError } = await supabase.rpc(
    "confirm_schedule_version_server",
    {
      p_schedule_version_id: persistedVersionId,
      p_actor_nickname: actorNickname,
    },
  );
  if (confirmError) throw new Error(`Unable to confirm schedule version: ${confirmError.message}`);
  const confirmed = asRecord(confirmedData);

  return {
    saved,
    confirmed,
    schedulePeriodId: requireString(confirmed, "schedule_period_id"),
    scheduleVersionId: requireString(confirmed, "schedule_version_id"),
    confirmedAt: requireString(confirmed, "confirmed_at"),
  };
}
