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

vi.mock("@/lib/schedule-cache", () => ({ getCachedSchedule: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock("@/lib/supabase/persistence", () => ({ persistAndConfirmSchedule: vi.fn() }));

import { POST } from "@/app/api/confirm/route";
import { getCachedSchedule } from "@/lib/schedule-cache";
import { isSupabaseConfigured } from "@/lib/supabase/admin";
import { persistAndConfirmSchedule } from "@/lib/supabase/persistence";

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

function request() {
  return new Request("http://localhost/api/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ periodId: "period-1", versionId: "version-1" }),
  });
}

function cacheVersion(candidate: Record<string, unknown>) {
  vi.mocked(getCachedSchedule).mockReturnValue({
    dataset: { period: { id: "period-1" } },
    versions: [candidate],
  } as never);
}

describe("POST /api/confirm fail-closed gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(persistAndConfirmSchedule).mockResolvedValue({
      scheduleVersionId: "persisted-version-1",
      confirmedAt: "2026-07-16T12:00:00.000Z",
    } as never);
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
        persisted: true,
        versionId: "version-1",
      });
      expect(persistAndConfirmSchedule).toHaveBeenCalledTimes(1);
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
  ])("rejects %s before persistence", async (_name, candidate, reason) => {
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
    expect(persistAndConfirmSchedule).not.toHaveBeenCalled();
  });

  it("keeps an eligible DEMO confirmation local even when Supabase is configured", async () => {
    cacheVersion(version({ solverStatus: "DEMO" }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      confirmed: true,
      persisted: false,
      persistenceMode: "LOCAL_DEMO",
    });
    expect(persistAndConfirmSchedule).not.toHaveBeenCalled();
  });

  it("keeps an eligible live confirmation local when Supabase is not configured", async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    cacheVersion(version());

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      confirmed: true,
      persisted: false,
      persistenceMode: "LOCAL_DEMO",
    });
    expect(persistAndConfirmSchedule).not.toHaveBeenCalled();
  });
});
