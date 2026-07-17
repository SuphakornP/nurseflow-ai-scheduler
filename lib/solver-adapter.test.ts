import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  datasetToSolverProblem,
  makeGenerateResponse,
  solverProblemToDataset,
  solverResultToVersion,
  type SolverGenerateResponse,
} from "@/lib/solver-adapter";
import type { ScheduleDataset, ScheduleVersion } from "@/lib/types";

const dataset: ScheduleDataset = {
  period: {
    id: "period-1",
    code: "MICU-2026-08",
    name: "August roster",
    departmentCode: "MICU",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    contextStartDate: "2026-07-31",
    contextEndDate: "2026-07-31",
    status: "READY",
  },
  nurses: [
    { id: "nurse-1", nickname: "Lotus", skillLevel: "INCHARGE" },
    { id: "nurse-2", nickname: "Mint", skillLevel: "MEMBER_L1" },
  ],
  requests: [
    {
      nurseId: "nurse-1",
      date: "2026-08-01",
      rawValue: "D",
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D"],
      constraintMode: "PREFERENCE",
      confidence: 0.8,
      requiresReview: true,
    },
    {
      nurseId: "nurse-2",
      date: "2026-08-01",
      rawValue: "VAC",
      normalizedType: "VACATION",
      allowedAssignments: ["VAC"],
      confidence: 1,
      requiresReview: false,
    },
  ],
  previousAssignments: [
    {
      nurseId: "nurse-1",
      date: "2026-07-31",
      shift: "N",
      source: "LOCKED_REQUEST",
    },
  ],
  sourceLabel: "Synthetic fixture",
  privacyMode: "NICKNAME_ONLY",
};

function result(
  overrides: Partial<SolverGenerateResponse> = {},
): SolverGenerateResponse {
  return {
    status: "OPTIMAL",
    message: "ok",
    assignments: [
      {
        nurse_id: "nurse-1",
        nickname: "Lotus",
        skill_level: "INCHARGE",
        assignment_date: "2026-08-01",
        shift: "N",
      },
      {
        nurse_id: "nurse-2",
        nickname: "Mint",
        skill_level: "MEMBER_L1",
        assignment_date: "2026-08-01",
        shift: "VAC",
      },
    ],
    metrics: {},
    phases: [],
    validation: {
      is_valid: true,
      checks: [
        {
          code: "COVERAGE",
          name: "Coverage",
          status: "PASS",
          violation_count: 0,
          details: [],
        },
      ],
    },
    solver_duration_ms: 1,
    ...overrides,
  };
}

describe("solver adapter request semantics", () => {
  it("sends imported requests as preferences and defaults legacy requests to locked", () => {
    const problem = datasetToSolverProblem(dataset, "balanced");

    expect(problem.requests[0]).toMatchObject({
      raw_value: "D",
      constraint_mode: "PREFERENCE",
      resolution: { allowed_assignments: ["D"] },
    });
    expect(problem.requests[1]).toMatchObject({
      raw_value: "VAC",
      constraint_mode: "LOCKED",
    });
  });

  it("round-trips preference and approved-lock modes from solver demo problems", () => {
    const problem = datasetToSolverProblem(dataset, "balanced");
    problem.requests[1].constraint_mode = "LOCKED";

    expect(
      solverProblemToDataset(problem).requests.map((request) => request.constraintMode),
    ).toEqual(["PREFERENCE", "LOCKED"]);
  });

  it("does not label a preferred vacation as a locked assignment", () => {
    const preferredDataset: ScheduleDataset = {
      ...dataset,
      requests: dataset.requests.map((request) => ({
        ...request,
        constraintMode: "PREFERENCE",
      })),
    };

    const version = solverResultToVersion(preferredDataset, result(), "balanced", 1);

    expect(version.assignments[1].source).toBe("SOLVER");
    expect(version.requestOutcomes[0]).toMatchObject({
      requested: "D",
      assigned: "N",
      satisfied: false,
    });
  });
});

describe("solver adapter evidence handling", () => {
  it("does not invent OFF outcomes or 100 percent metrics for infeasible results", () => {
    const version = solverResultToVersion(
      dataset,
      result({ status: "INFEASIBLE", assignments: [], validation: null }),
      "balanced",
      1,
    );

    expect(version.status).toBe("INVALID");
    expect(version.solverStatus).toBe("INFEASIBLE");
    expect(version.requestOutcomes).toEqual([]);
    expect(version.metrics).toMatchObject({
      requestSatisfactionRate: 0,
      offSatisfactionRate: 0,
      o1SatisfactionRate: 0,
      dayBalanceScore: 0,
      nightBalanceScore: 0,
      weekendBalanceScore: 0,
      hardConstraintsPassed: 0,
      hardConstraintsTotal: 0,
    });
  });

  it("reports how many candidates actually passed hard validation", () => {
    const valid = solverResultToVersion(dataset, result(), "balanced", 1);
    const invalid: ScheduleVersion = {
      ...valid,
      id: "period-1-requests-first",
      versionNo: 2,
      status: "INVALID",
      solverStatus: "INFEASIBLE",
      validations: [],
    };

    expect(makeGenerateResponse(dataset, [valid, invalid]).message).toBe(
      "1 of 2 CP-SAT candidates passed hard validation.",
    );
    expect(makeGenerateResponse(dataset, [invalid]).message).toBe(
      "0 of 1 CP-SAT candidate passed hard validation.",
    );
  });
});
