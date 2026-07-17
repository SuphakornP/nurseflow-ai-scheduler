import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/request", () => ({
  requireAdminRequest: vi.fn(async () => ({
    ok: true,
    session: { email: "admin@example.com", displayName: "Scheduler", role: "ADMIN" },
  })),
}));

vi.mock("@/lib/schedule-cache", () => ({ getCachedSchedule: vi.fn() }));
vi.mock("@/lib/solver-client", () => ({
  SolverUnavailableError: class SolverUnavailableError extends Error {},
  callSolverBinary: vi.fn(),
}));
vi.mock("@/lib/solver-adapter", () => ({
  datasetToSolverProblem: vi.fn(() => ({})),
  versionToSolverAssignments: vi.fn(() => []),
}));
vi.mock("@/lib/supabase/admin", () => ({ isSupabaseConfigured: vi.fn(() => false) }));
vi.mock("@/lib/supabase/persisted-export", () => ({
  loadPersistedVersionForExport: vi.fn(),
}));

import { POST } from "@/app/api/export/route";
import { getCachedSchedule } from "@/lib/schedule-cache";
import { callSolverBinary } from "@/lib/solver-client";

const validHardCheck = {
  code: "COVERAGE",
  name: "Coverage",
  type: "HARD",
  status: "PASS",
  violationCount: 0,
  details: [],
};

function request() {
  return new Request("http://localhost/api/export", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ periodId: "period-1", versionId: "version-1" }),
  });
}

function cachedVersion(overrides: Record<string, unknown> = {}) {
  return {
    dataset: { period: { id: "period-1" }, nurses: [], requests: [] },
    versions: [
      {
        id: "version-1",
        status: "VALID",
        solverStatus: "FEASIBLE",
        validations: [validHardCheck],
        assignments: [],
        ...overrides,
      },
    ],
  };
}

describe("POST /api/export safety gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["INFEASIBLE", { status: "INVALID", solverStatus: "INFEASIBLE", validations: [] }],
    ["missing evidence", { status: "VALID", solverStatus: "FEASIBLE", validations: [] }],
    [
      "failed hard rule",
      {
        status: "VALID",
        solverStatus: "FEASIBLE",
        validations: [{ ...validHardCheck, status: "FAIL", violationCount: 1 }],
      },
    ],
  ])("rejects %s versions before calling the solver", async (_label, version) => {
    vi.mocked(getCachedSchedule).mockReturnValue(cachedVersion(version) as never);

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "VERSION_NOT_EXPORTABLE",
      message:
        "Only a VALID schedule with complete passing hard-validation evidence can be exported.",
    });
    expect(callSolverBinary).not.toHaveBeenCalled();
  });

  it("exports a VALID version with passing hard evidence", async () => {
    vi.mocked(getCachedSchedule).mockReturnValue(cachedVersion() as never);
    vi.mocked(callSolverBinary).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: "schedule.xlsx",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(callSolverBinary).toHaveBeenCalledOnce();
  });
});
