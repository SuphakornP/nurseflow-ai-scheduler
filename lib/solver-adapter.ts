import "server-only";

import { normalizeRequestValue } from "@/lib/normalizer";
import type {
  Assignment,
  ConstraintResult,
  GenerateScheduleResponse,
  Nurse,
  RequestConstraintMode,
  RequestOutcome,
  ScheduleDataset,
  ScheduleVersion,
  ShiftCode,
  ShiftRequest,
  SkillLevel,
  VersionMetrics,
} from "@/lib/types";

export type OptimizationProfile = "balanced" | "requests_first" | "minimize_l0";

export interface SolverProblem {
  period_name: string;
  period_start: string;
  period_end: string;
  nurses: Array<{ id: string; nickname: string; skill_level: SkillLevel }>;
  requests: Array<{
    nurse_id: string;
    request_date: string;
    raw_value: string;
    constraint_mode: RequestConstraintMode;
    resolution?: {
      allowed_assignments?: ShiftCode[];
      locked_shift?: ShiftCode | null;
      off_priority?: number | null;
    };
  }>;
  previous_assignments: Array<{
    nurse_id: string;
    assignment_date: string;
    shift: ShiftCode;
  }>;
  time_limit_seconds: number;
  random_seed: number;
  optimization_profile?: OptimizationProfile;
}

export interface SolverAssignment {
  nurse_id: string;
  nickname: string;
  skill_level: SkillLevel;
  assignment_date: string;
  shift: ShiftCode;
}

export interface SolverGenerateResponse {
  status: string;
  message: string;
  assignments: SolverAssignment[];
  metrics: Record<string, number | string>;
  phases: Array<{ name: string; value: number; status: string }>;
  validation: null | {
    is_valid: boolean;
    checks: Array<{
      code: string;
      name: string;
      status: "PASS" | "FAIL";
      violation_count: number;
      details: string[];
    }>;
  };
  solver_duration_ms: number;
}

export type SolverDemoProblem = SolverProblem;

function profileSeed(profile: OptimizationProfile) {
  if (profile === "requests_first") return 20260801;
  if (profile === "minimize_l0") return 20260803;
  return 20260802;
}

export function datasetToSolverProblem(
  dataset: ScheduleDataset,
  profile: OptimizationProfile,
): SolverProblem {
  return {
    period_name: dataset.period.name,
    period_start: dataset.period.startDate,
    period_end: dataset.period.endDate,
    nurses: dataset.nurses.map((nurse) => ({
      id: nurse.id,
      nickname: nurse.nickname,
      skill_level: nurse.skillLevel,
    })),
    requests: dataset.requests.map((request) => ({
      nurse_id: request.nurseId,
      request_date: request.date,
      raw_value: request.rawValue,
      constraint_mode: request.constraintMode,
      ...(request.requiresReview
        ? {
            resolution: {
              allowed_assignments: request.allowedAssignments,
              off_priority: request.priority ?? null,
            },
          }
        : {}),
    })),
    previous_assignments: dataset.previousAssignments.map((assignment) => ({
      nurse_id: assignment.nurseId,
      assignment_date: assignment.date,
      shift: assignment.shift,
    })),
    time_limit_seconds: 12,
    random_seed: profileSeed(profile),
    optimization_profile: profile,
  };
}

export function solverProblemToDataset(problem: SolverDemoProblem): ScheduleDataset {
  const periodId = `period-${problem.period_start}-${problem.period_end}`;
  const nurses: Nurse[] = problem.nurses.map((nurse) => ({
    id: nurse.id,
    nickname: nurse.nickname,
    skillLevel: nurse.skill_level,
    synthetic: true,
  }));
  const requests: ShiftRequest[] = problem.requests.map((request) => {
    const constraintMode = request.constraint_mode;
    const normalized = normalizeRequestValue(
      request.raw_value,
      request.nurse_id,
      request.request_date,
      constraintMode,
    );
    if (!request.resolution) return normalized;
    const allowedAssignments = request.resolution.allowed_assignments?.length
      ? request.resolution.allowed_assignments
      : request.resolution.locked_shift
        ? [request.resolution.locked_shift]
        : normalized.allowedAssignments;
    return {
      ...normalized,
      allowedAssignments,
      priority:
        request.resolution.off_priority === null ||
        request.resolution.off_priority === undefined
          ? normalized.priority
          : (request.resolution.off_priority as 1 | 2 | 3 | 4),
      confidence: 1,
      requiresReview: false,
    };
  });
  const previousDates = problem.previous_assignments
    .map((item) => item.assignment_date)
    .sort();
  return {
    period: {
      id: periodId,
      code: `MICU-${problem.period_start.slice(0, 7)}`,
      name: problem.period_name,
      departmentCode: "MICU",
      startDate: problem.period_start,
      endDate: problem.period_end,
      contextStartDate: previousDates[0] || problem.period_start,
      contextEndDate: previousDates.at(-1) || problem.period_start,
      status: "READY",
    },
    nurses,
    requests,
    previousAssignments: problem.previous_assignments.map((assignment) => ({
      nurseId: assignment.nurse_id,
      date: assignment.assignment_date,
      shift: assignment.shift,
      source: "LOCKED_REQUEST",
    })),
    sourceLabel: "Synthetic Build Week dataset",
    privacyMode: "NICKNAME_ONLY",
  };
}

function scoreFromSpread(values: number[]) {
  if (!values.length) return 100;
  const range = Math.max(...values) - Math.min(...values);
  return Math.max(0, Math.round((100 - range * 6) * 10) / 10);
}

function scoreWithinComparableSkillGroups(
  dataset: ScheduleDataset,
  values: number[],
) {
  const groups = new Map<string, number[]>();
  dataset.nurses.forEach((nurse, index) => {
    // L0 is emergency-only and is intentionally not assigned like regular staff.
    if (nurse.skillLevel === "MEMBER_L0") return;
    const group = groups.get(nurse.skillLevel) ?? [];
    group.push(values[index] ?? 0);
    groups.set(nurse.skillLevel, group);
  });

  const comparableGroups = [...groups.values()].filter((group) => group.length > 1);
  const staffCount = comparableGroups.reduce((total, group) => total + group.length, 0);
  if (!staffCount) return 100;
  const weightedScore = comparableGroups.reduce(
    (total, group) => total + scoreFromSpread(group) * group.length,
    0,
  );
  return Math.round((weightedScore / staffCount) * 10) / 10;
}

function requestOutcomes(
  dataset: ScheduleDataset,
  assignments: Assignment[],
): RequestOutcome[] {
  const assignmentMap = new Map(
    assignments.map((assignment) => [`${assignment.nurseId}:${assignment.date}`, assignment.shift]),
  );
  return dataset.requests
    .filter((request) => request.normalizedType !== "AVAILABLE")
    .flatMap((request) => {
      const assigned = assignmentMap.get(`${request.nurseId}:${request.date}`);
      if (!assigned) return [];
      const satisfied = request.allowedAssignments.includes(assigned);
      return [{
        nurseId: request.nurseId,
        date: request.date,
        requested: request.rawValue,
        normalizedType: request.normalizedType,
        constraintMode: request.constraintMode,
        assigned,
        priority: request.priority,
        satisfied,
        reasonCode: satisfied
          ? undefined
          : request.constraintMode === "LOCKED"
            ? "MANDATORY_EVENT_VIOLATION"
            : request.constraintMode === "REQUIRED"
              ? "REQUIRED_CHOICE_VIOLATION"
              : "STAFFING_OR_SEQUENCE_COVERAGE",
        explanation: satisfied
          ? request.constraintMode === "LOCKED"
            ? `${request.rawValue} is an approved fixed event and was preserved.`
            : request.constraintMode === "REQUIRED"
              ? `${assigned} satisfies the required ${request.rawValue} choice.`
              : `${request.rawValue || "Availability"} was respected by the optimizer.`
          : request.constraintMode === "LOCKED"
            ? `${request.rawValue} is mandatory. This assignment must fail hard validation and cannot be confirmed.`
            : request.constraintMode === "REQUIRED"
              ? `${assigned} is outside the required ${request.rawValue} choice. This assignment cannot be confirmed.`
              : `${request.rawValue} was not selected because assigning ${assigned} was required to preserve staffing, skill mix, or sequence constraints after higher-priority requests were considered.`,
      }];
    });
}

function hasCompleteAssignmentEvidence(
  dataset: ScheduleDataset,
  assignments: Assignment[],
) {
  const periodDays =
    Math.floor(
      (Date.parse(`${dataset.period.endDate}T00:00:00Z`) -
        Date.parse(`${dataset.period.startDate}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  const expectedCount = periodDays * dataset.nurses.length;
  if (assignments.length !== expectedCount) return false;

  const knownNurseIds = new Set(dataset.nurses.map((nurse) => nurse.id));
  const keys = new Set<string>();
  for (const assignment of assignments) {
    if (
      !knownNurseIds.has(assignment.nurseId) ||
      assignment.date < dataset.period.startDate ||
      assignment.date > dataset.period.endDate
    ) {
      return false;
    }
    keys.add(`${assignment.nurseId}\0${assignment.date}`);
  }
  return keys.size === expectedCount;
}

function computeMetrics(
  dataset: ScheduleDataset,
  assignments: Assignment[],
  validations: ConstraintResult[],
  outcomes: RequestOutcome[],
): VersionMetrics {
  const completeEvidence = hasCompleteAssignmentEvidence(dataset, assignments);
  const clinical = assignments.filter((item) => item.shift === "D" || item.shift === "N");
  const dayCounts = dataset.nurses.map(
    (nurse) => clinical.filter((item) => item.nurseId === nurse.id && item.shift === "D").length,
  );
  const nightCounts = dataset.nurses.map(
    (nurse) => clinical.filter((item) => item.nurseId === nurse.id && item.shift === "N").length,
  );
  const weekendCounts = dataset.nurses.map(
    (nurse) =>
      clinical.filter((item) => {
        const day = new Date(`${item.date}T00:00:00Z`).getUTCDay();
        return item.nurseId === nurse.id && (day === 0 || day === 6);
      }).length,
  );
  const preferenceOutcomes = outcomes.filter((item) => item.constraintMode === "PREFERENCE");
  const lockedOutcomes = outcomes.filter((item) => item.constraintMode === "LOCKED");
  const requiredOutcomes = outcomes.filter((item) => item.constraintMode === "REQUIRED");
  const offOutcomes = preferenceOutcomes.filter(
    (item) => item.normalizedType === "OFF_REQUEST",
  );
  const o1 = offOutcomes.filter((item) => item.priority === 1);
  const hard = validations.filter((item) => item.type === "HARD");
  const l0Ids = new Set(
    dataset.nurses.filter((item) => item.skillLevel === "MEMBER_L0").map((item) => item.id),
  );
  return {
    requestSatisfactionRate: !completeEvidence
      ? 0
      : preferenceOutcomes.length
        ? (preferenceOutcomes.filter((item) => item.satisfied).length /
            preferenceOutcomes.length) * 100
        : 100,
    offSatisfactionRate: !completeEvidence
      ? 0
      : offOutcomes.length
      ? (offOutcomes.filter((item) => item.satisfied).length / offOutcomes.length) * 100
      : 100,
    o1SatisfactionRate: !completeEvidence
      ? 0
      : o1.length
      ? (o1.filter((item) => item.satisfied).length / o1.length) * 100
      : 100,
    dayBalanceScore: completeEvidence
      ? scoreWithinComparableSkillGroups(dataset, dayCounts)
      : 0,
    nightBalanceScore: completeEvidence
      ? scoreWithinComparableSkillGroups(dataset, nightCounts)
      : 0,
    weekendBalanceScore: completeEvidence
      ? scoreWithinComparableSkillGroups(dataset, weekendCounts)
      : 0,
    memberL0Usage: clinical.filter((item) => l0Ids.has(item.nurseId)).length,
    hardConstraintsPassed: hard.filter((item) => item.status === "PASS").length,
    hardConstraintsTotal: hard.length,
    lockedRequirementsPassed: completeEvidence
      ? lockedOutcomes.filter((item) => item.satisfied).length
      : 0,
    lockedRequirementsTotal: lockedOutcomes.length,
    requiredChoicesPassed: completeEvidence
      ? requiredOutcomes.filter((item) => item.satisfied).length
      : 0,
    requiredChoicesTotal: requiredOutcomes.length,
  };
}

export function solverResultToVersion(
  dataset: ScheduleDataset,
  result: SolverGenerateResponse,
  profile: OptimizationProfile,
  versionNo: number,
): ScheduleVersion {
  const assignments: Assignment[] = result.assignments.map((assignment) => ({
    nurseId: assignment.nurse_id,
    date: assignment.assignment_date,
    shift: assignment.shift,
    source: dataset.requests.some(
      (request) =>
        request.nurseId === assignment.nurse_id &&
        request.date === assignment.assignment_date &&
        request.constraintMode === "LOCKED" &&
        ["VACATION", "EDUCATION"].includes(request.normalizedType),
    )
      ? "LOCKED_REQUEST"
      : "SOLVER",
  }));
  const validations: ConstraintResult[] =
    result.validation?.checks.map((check) => ({
      code: check.code,
      name: check.name,
      type: "HARD",
      status: check.status,
      violationCount: check.violation_count,
      details: check.details,
    })) || [];
  const outcomes = requestOutcomes(dataset, assignments);
  const profileNames: Record<OptimizationProfile, string> = {
    requests_first: "Request priority",
    balanced: "Balanced roster",
    minimize_l0: "Minimum L0",
  };
  const valid = Boolean(result.validation?.is_valid);
  return {
    id: `${dataset.period.id}-${profile}`,
    versionNo,
    name: profileNames[profile],
    status: valid ? "VALID" : "INVALID",
    solverStatus:
      result.status === "OPTIMAL"
        ? "OPTIMAL"
        : result.status === "INFEASIBLE"
          ? "INFEASIBLE"
          : "FEASIBLE",
    generatedAt: new Date().toISOString(),
    objectiveScore: result.phases.reduce((sum, phase) => sum + phase.value, 0),
    assignments,
    validations,
    metrics: computeMetrics(dataset, assignments, validations, outcomes),
    requestOutcomes: outcomes,
  };
}

export function makeGenerateResponse(
  dataset: ScheduleDataset,
  versions: ScheduleVersion[],
): GenerateScheduleResponse {
  const validCount = versions.filter((version) => version.status === "VALID").length;
  return {
    dataset: {
      ...dataset,
      period: { ...dataset.period, status: versions.length ? "GENERATED" : "READY" },
    },
    versions,
    mode: "solver",
    message:
      versions.length === 0
        ? "No schedule candidates were generated."
        : `${validCount} of ${versions.length} CP-SAT candidate${versions.length === 1 ? "" : "s"} passed hard validation.`,
  };
}

export function versionToSolverAssignments(
  dataset: ScheduleDataset,
  version: ScheduleVersion,
): SolverAssignment[] {
  const nurseMap = new Map(dataset.nurses.map((nurse) => [nurse.id, nurse]));
  return version.assignments.map((assignment) => {
    const nurse = nurseMap.get(assignment.nurseId);
    if (!nurse) throw new Error(`Unknown nurse in version: ${assignment.nurseId}`);
    return {
      nurse_id: nurse.id,
      nickname: nurse.nickname,
      skill_level: nurse.skillLevel,
      assignment_date: assignment.date,
      shift: assignment.shift,
    };
  });
}
