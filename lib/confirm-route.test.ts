import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/request", () => ({
  requireAdminRequest: vi.fn(async () => ({
    ok: true,
    session: {
      sessionId: "session-1",
      email: "admin@example.com",
      displayName: "Head Scheduler",
      role: "ADMIN",
    },
  })),
}));

vi.mock("@/lib/schedule-cache", () => ({ getCachedCandidate: vi.fn() }));

import { POST } from "@/app/api/confirm/route";
import { createDemoResponse } from "@/components/demo-data";
import { getCachedCandidate } from "@/lib/schedule-cache";

function hardValidation(overrides: Record<string, unknown> = {}) {
  return {
    code: "COVERAGE",
    name: "Coverage",
    type: "HARD",
    status: "PASS",
    violationCount: 0,
    details: [],
    ...overrides,
  };
}

function softValidation() {
  return {
    code: "PREFERENCE",
    name: "Preference",
    type: "SOFT",
    status: "WARNING",
    violationCount: 1,
    details: ["One preference was not selected."],
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    versionNo: 1,
    status: "VALID",
    solverStatus: "OPTIMAL",
    validations: [hardValidation()],
    ...overrides,
  };
}

function request(periodId = "period-1", versionId = "version-1") {
  return new Request("http://localhost/api/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ periodId, versionId }),
  });
}

function cacheVersion(candidate: Record<string, unknown>) {
  vi.mocked(getCachedCandidate).mockReturnValue({
    dataset: { period: { id: "period-1" } },
    version: candidate,
    generation: {},
  } as never);
}

describe("POST /api/confirm fail-closed gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["OPTIMAL", "FEASIBLE"])(
    "confirms a VALID %s version with at least one passing hard validation",
    async (solverStatus) => {
      cacheVersion(
        version({
          solverStatus,
          validations: [hardValidation(), softValidation()],
        }),
      );

      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        confirmed: true,
        confirmedAt: expect.any(String),
        versionId: "version-1",
      });
      expect(getCachedCandidate).toHaveBeenCalledWith("session-1", "period-1", "version-1");
    },
  );

  it.each([
    ["non-VALID version", version({ status: "INVALID" }), "VERSION_NOT_VALID"],
    ["INFEASIBLE solver result", version({ solverStatus: "INFEASIBLE" }), "SOLVER_INFEASIBLE"],
    ["empty validations", version({ validations: [] }), "NO_HARD_VALIDATIONS"],
    ["soft-only validations", version({ validations: [softValidation()] }), "NO_HARD_VALIDATIONS"],
    [
      "failed hard validation",
      version({ validations: [hardValidation({ status: "FAIL", violationCount: 1 })] }),
      "HARD_VALIDATION_FAILED",
    ],
    [
      "warning hard validation",
      version({ validations: [hardValidation({ status: "WARNING" })] }),
      "HARD_VALIDATION_FAILED",
    ],
    ["non-array validations", version({ validations: null }), "INVALID_VALIDATION_DATA"],
    [
      "malformed validation entry",
      version({ validations: [hardValidation({ details: "not-an-array" })] }),
      "INVALID_VALIDATION_DATA",
    ],
    [
      "inconsistent PASS validation",
      version({ validations: [hardValidation({ violationCount: 1 })] }),
      "INVALID_VALIDATION_DATA",
    ],
    [
      "duplicate validation codes",
      version({ validations: [hardValidation(), hardValidation()] }),
      "INVALID_VALIDATION_DATA",
    ],
  ])("rejects %s before confirmation", async (_name, candidate, reason) => {
    cacheVersion(candidate);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ reason });
    expect(body.error).toBe(
      reason === "HARD_VALIDATION_FAILED"
        ? "HARD_CONSTRAINT_FAILURE"
        : "CONFIRMATION_NOT_ALLOWED",
    );
  });

  it("returns the same confirmation timestamp on retries", async () => {
    vi.useFakeTimers();
    cacheVersion(version());
    const first = await (await POST(request())).json();
    vi.advanceTimersByTime(60_000);
    const second = await (await POST(request())).json();

    expect(second.confirmedAt).toBe(first.confirmedAt);
  });

  it("locks one choice under concurrent confirmations and permits a separate calculation", async () => {
    const cache = await vi.importActual<typeof import("@/lib/schedule-cache")>("@/lib/schedule-cache");
    vi.mocked(getCachedCandidate).mockImplementation(cache.getCachedCandidate);
    const run = createDemoResponse();
    const periodId = run.dataset.period.id;
    const [first, second] = run.versions;
    cache.cacheSchedule("session-1", run);

    const attempts = await Promise.all(
      [first, second].map((candidate) => POST(request(periodId, candidate.id))),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
    const accepted = await attempts.find((attempt) => attempt.ok)!.json();
    const conflict = attempts.find((attempt) => !attempt.ok)!;
    await expect(conflict.json()).resolves.toMatchObject({ error: "GENERATION_ALREADY_CONFIRMED" });
    await expect((await POST(request(periodId, accepted.versionId))).json()).resolves.toEqual(accepted);

    const next = { ...first, id: "new-generation" };
    cache.cacheSchedule("session-1", { ...run, versions: [next] });
    expect((await POST(request(periodId, next.id))).status).toBe(200);
  });

  it("requires regeneration when the candidate is unavailable", async () => {
    vi.mocked(getCachedCandidate).mockReturnValue(null);
    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "VERSION_NOT_FOUND" });
  });
});
