import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/request", () => ({
  requireAdminRequest: vi.fn(async () => ({
    ok: true,
    session: {
      email: "admin@example.com",
      displayName: "Head Scheduler",
      role: "ADMIN",
    },
  })),
}));

vi.mock("@/lib/openai-explanation", () => ({ explainScheduleOutcome: vi.fn() }));
vi.mock("@/lib/openai-normalization", () => ({ suggestNormalizations: vi.fn() }));
vi.mock("@/lib/supabase/persistence", () => ({ persistAndConfirmSchedule: vi.fn() }));
vi.mock("@/lib/supabase/persisted-export", () => ({
  loadPersistedVersionForExport: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
}));
vi.mock("@/lib/schedule-cache", () => ({
  cacheSchedule: vi.fn(),
  getCachedSchedule: vi.fn(),
}));
vi.mock("@/lib/solver-adapter", () => ({
  datasetToSolverProblem: vi.fn(() => ({})),
  makeGenerateResponse: vi.fn(),
  solverProblemToDataset: vi.fn(),
  solverResultToVersion: vi.fn(),
  versionToSolverAssignments: vi.fn(() => []),
}));
vi.mock("@/lib/solver-client", () => {
  class SolverUnavailableError extends Error {}
  class SolverRejectedError extends Error {
    readonly status = 422;
    constructor(
      readonly path: string,
      readonly diagnostic: {
        kind: string;
        issueCount: number;
        reasonCodes: string[];
        fieldPaths: string[];
        issueTypes: string[];
      },
    ) {
      super("Solver rejected input");
    }
  }
  return {
    SolverRejectedError,
    SolverUnavailableError,
    callSolver: vi.fn(),
    callSolverBinary: vi.fn(),
  };
});

import { POST as confirm } from "@/app/api/confirm/route";
import { POST as demo } from "@/app/api/demo/route";
import { POST as explain } from "@/app/api/explain/route";
import { POST as exportSchedule } from "@/app/api/export/route";
import { POST as generate } from "@/app/api/generate/route";
import { GET as health } from "@/app/api/health/route";
import { GET as history } from "@/app/api/history/route";
import { POST as normalize } from "@/app/api/normalize/route";
import { explainScheduleOutcome } from "@/lib/openai-explanation";
import { suggestNormalizations } from "@/lib/openai-normalization";
import { getCachedSchedule } from "@/lib/schedule-cache";
import {
  callSolver,
  callSolverBinary,
  SolverRejectedError,
  SolverUnavailableError,
} from "@/lib/solver-client";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";
import { persistAndConfirmSchedule } from "@/lib/supabase/persistence";

const INTERNAL_DETAIL = "provider-internal-detail: upstream stack context";
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
const POST_HEADERS = { "content-type": "application/json", origin: "http://localhost" };
const VALID_DATASET = {
  period: {
    id: "period-1",
    code: "AUG-2026",
    name: "August 2026",
    departmentCode: "ICU",
    startDate: "2026-08-01",
    endDate: "2026-08-01",
    contextStartDate: "2026-07-31",
    contextEndDate: "2026-08-01",
    status: "READY",
  },
  nurses: [{ id: "nurse-1", nickname: "N01", skillLevel: "INCHARGE" }],
  requests: [],
  previousAssignments: [],
  sourceLabel: "Sanitization test",
  privacyMode: "NICKNAME_ONLY",
};

function postRequest(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: POST_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectSanitized(
  response: Response,
  expected: { status: number; error?: string; message: string },
) {
  const body = await response.json();
  expect(response.status).toBe(expected.status);
  expect(body).toMatchObject({ error: expected.error, message: expected.message });
  expect(JSON.stringify(body)).not.toContain(INTERNAL_DETAIL);
}

describe("API provider error sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(getCachedSchedule).mockReturnValue({
      dataset: { period: {} },
      versions: [
        {
          id: "version-1",
          versionNo: 1,
          status: "VALID",
          solverStatus: "OPTIMAL",
          validations: [
            {
              code: "COVERAGE",
              name: "Coverage",
              type: "HARD",
              status: "PASS",
              violationCount: 0,
              details: [],
            },
          ],
        },
      ],
    } as never);
  });

  it("does not expose OpenAI explanation or normalization errors", async () => {
    vi.mocked(explainScheduleOutcome).mockRejectedValue(new Error(INTERNAL_DETAIL));
    vi.mocked(suggestNormalizations).mockRejectedValue(new Error(INTERNAL_DETAIL));

    await expectSanitized(
      await explain(
        postRequest("/api/explain", {
          periodId: "period-1",
          nurseNickname: "N01",
          date: "2026-08-01",
          requested: "OFF",
          assigned: "D",
          reasonCode: "coverage_required",
          facts: [],
        }),
      ),
      {
        status: 502,
        error: "OPENAI_EXPLANATION_FAILED",
        message: "AI explanation is temporarily unavailable. The solver reason remains available.",
      },
    );

    await expectSanitized(
      await normalize(
        postRequest("/api/normalize", {
          periodId: "period-1",
          items: [{ id: "N01:2026-08-01", rawValue: "O/N" }],
        }),
      ),
      {
        status: 502,
        error: "OPENAI_NORMALIZATION_FAILED",
        message: "AI normalization is temporarily unavailable. Review ambiguous values manually.",
      },
    );
  });

  it("does not expose Supabase query or confirmation errors", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: INTERNAL_DETAIL },
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query),
    } as never);
    vi.mocked(persistAndConfirmSchedule).mockRejectedValue(new Error(INTERNAL_DETAIL));

    await expectSanitized(
      await history(new Request("http://localhost/api/history?periodId=period-1")),
      {
        status: 500,
        error: "HISTORY_QUERY_FAILED",
        message: "Schedule history is temporarily unavailable. Try again shortly.",
      },
    );

    await expectSanitized(
      await confirm(
        postRequest("/api/confirm", { periodId: "period-1", versionId: "version-1" }),
      ),
      {
        status: 409,
        error: "SUPABASE_CONFIRM_FAILED",
        message: "The schedule could not be confirmed. Verify that the period is staged and try again.",
      },
    );
  });

  it("keeps export status codes without exposing solver or persistence details", async () => {
    vi.mocked(callSolverBinary).mockRejectedValue(new SolverUnavailableError(INTERNAL_DETAIL));
    await expectSanitized(
      await exportSchedule(
        postRequest("/api/export", { periodId: "period-1", versionId: "version-1" }),
      ),
      {
        status: 503,
        error: "EXPORT_FAILED",
        message: "The export service is temporarily unavailable. Try again shortly.",
      },
    );

    vi.mocked(callSolverBinary).mockRejectedValue(new Error(INTERNAL_DETAIL));
    await expectSanitized(
      await exportSchedule(
        postRequest("/api/export", { periodId: "period-1", versionId: "version-1" }),
      ),
      {
        status: 500,
        error: "EXPORT_FAILED",
        message: "The workbook could not be exported. Verify the selected schedule version and try again.",
      },
    );
  });

  it("keeps demo and generation status codes without exposing solver details", async () => {
    vi.mocked(callSolver).mockRejectedValue(new SolverUnavailableError(INTERNAL_DETAIL));
    await expectSanitized(await demo(postRequest("/api/demo")), {
      status: 503,
      error: "SOLVER_UNAVAILABLE",
      message: "Demo schedule generation is temporarily unavailable. Try again shortly.",
    });
    await expectSanitized(
      await generate(postRequest("/api/generate", { dataset: VALID_DATASET })),
      {
        status: 503,
        error: "GENERATION_FAILED",
        message: "Schedule generation is temporarily unavailable. Try again shortly.",
      },
    );
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(INTERNAL_DETAIL);

    const rejected = Object.assign(
      new SolverRejectedError("/generate", {
        kind: "input_problem",
        issueCount: 2,
        reasonCodes: ["UNRESOLVED_REQUEST"],
        fieldPaths: [],
        issueTypes: [],
      }),
      { privateDetail: INTERNAL_DETAIL },
    );
    vi.mocked(callSolver).mockRejectedValue(rejected);
    const rejectedResponse = await generate(
      postRequest("/api/generate", { dataset: VALID_DATASET }),
    );
    await expectSanitized(rejectedResponse, {
      status: 422,
      error: "SOLVER_INPUT_REJECTED",
      message:
        "The solver rejected the normalized request set. Review unresolved values and request rules, then try again.",
    });
    expect(rejectedResponse.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
    const warningLog = JSON.stringify(warnSpy.mock.calls);
    expect(warningLog).toContain("solver.generate.failed");
    expect(warningLog).toContain("INPUT_REJECTED");
    expect(warningLog).toContain("UNRESOLVED_REQUEST");
    expect(warningLog).not.toContain(INTERNAL_DETAIL);

    vi.mocked(callSolver).mockRejectedValue(new Error(INTERNAL_DETAIL));
    await expectSanitized(await demo(postRequest("/api/demo")), {
      status: 500,
      error: "SOLVER_UNAVAILABLE",
      message: "The demo schedule could not be prepared. Try again.",
    });
    await expectSanitized(
      await generate(postRequest("/api/generate", { dataset: VALID_DATASET })),
      {
        status: 500,
        error: "GENERATION_FAILED",
        message: "The schedule could not be generated because of an internal error. Try again.",
      },
    );
  });

  it("reports only solver readiness in health responses", async () => {
    vi.mocked(callSolver).mockRejectedValue(new Error(INTERNAL_DETAIL));
    const response = await health(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.services.solver).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(INTERNAL_DETAIL);
  });
});
