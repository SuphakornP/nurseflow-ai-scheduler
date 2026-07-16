import { describe, expect, it } from "vitest";

import {
  getConfirmationEligibility,
  getConfirmationGatePresentation,
  parseConfirmationSuccess,
} from "@/lib/confirmation-eligibility";

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

function softValidation(overrides: Record<string, unknown> = {}) {
  return {
    code: "PREFERENCE",
    name: "Preference",
    type: "SOFT",
    status: "WARNING",
    violationCount: 1,
    details: ["One request was not selected."],
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    status: "VALID",
    solverStatus: "OPTIMAL",
    validations: [hardValidation()],
    ...overrides,
  };
}

describe("getConfirmationEligibility", () => {
  it.each(["OPTIMAL", "FEASIBLE", "DEMO"])(
    "allows a VALID %s result with complete passing hard evidence",
    (solverStatus) => {
      const result = getConfirmationEligibility(
        version({
          solverStatus,
          validations: [hardValidation(), hardValidation({ code: "REST", name: "Rest" })],
        }),
      );

      expect(result).toMatchObject({
        eligible: true,
        reason: null,
        gateLabel: "Ready",
        summary: "2/2 hard rules",
        hardPassed: 2,
        hardTotal: 2,
      });
    },
  );

  it("allows valid soft failures when every hard validation passes", () => {
    expect(
      getConfirmationEligibility(
        version({ validations: [hardValidation(), softValidation({ status: "FAIL" })] }),
      ).eligible,
    ).toBe(true);
  });

  it.each(["CANDIDATE", "INVALID", "CONFIRMED", undefined])(
    "blocks a version whose status is %s",
    (status) => {
      expect(getConfirmationEligibility(version({ status }))).toMatchObject({
        eligible: false,
        reason: "VERSION_NOT_VALID",
        gateLabel: "Blocked",
      });
    },
  );

  it("blocks INFEASIBLE and unknown solver statuses", () => {
    expect(getConfirmationEligibility(version({ solverStatus: "INFEASIBLE" }))).toMatchObject({
      eligible: false,
      reason: "SOLVER_INFEASIBLE",
    });
    expect(getConfirmationEligibility(version({ solverStatus: "UNKNOWN" }))).toMatchObject({
      eligible: false,
      reason: "INVALID_SOLVER_STATUS",
    });
  });

  it("blocks empty and soft-only validation evidence without reporting Ready 0/0", () => {
    const empty = getConfirmationEligibility(version({ validations: [] }));
    const softOnly = getConfirmationEligibility(version({ validations: [softValidation()] }));

    expect(empty).toMatchObject({
      eligible: false,
      reason: "NO_HARD_VALIDATIONS",
      gateLabel: "Blocked",
      summary: "No hard-validation evidence",
      hardPassed: 0,
      hardTotal: 0,
    });
    expect(`${empty.gateLabel} ${empty.summary}`).not.toContain("Ready 0/0");
    expect(softOnly).toMatchObject({
      eligible: false,
      reason: "NO_HARD_VALIDATIONS",
      gateLabel: "Blocked",
    });
  });

  it.each(["FAIL", "WARNING"])("blocks a hard validation with status %s", (status) => {
    const result = getConfirmationEligibility(
      version({ validations: [hardValidation(), hardValidation({ code: "REST", status })] }),
    );

    expect(result).toMatchObject({
      eligible: false,
      reason: "HARD_VALIDATION_FAILED",
      gateLabel: "Blocked",
      hardPassed: 1,
      hardTotal: 2,
      failedHardRuleCodes: ["REST"],
    });
  });

  it.each([
    ["no version", null],
    ["non-object version", "VALID"],
    ["missing validations", version({ validations: undefined })],
    ["non-array validations", version({ validations: {} })],
    ["null validation", version({ validations: [null] })],
    ["missing validation type", version({ validations: [hardValidation({ type: undefined })] })],
    ["unknown validation type", version({ validations: [hardValidation({ type: "UNKNOWN" })] })],
    ["missing validation status", version({ validations: [hardValidation({ status: undefined })] })],
    ["unknown validation status", version({ validations: [hardValidation({ status: "UNKNOWN" })] })],
    ["non-integer violations", version({ validations: [hardValidation({ violationCount: 0.5 })] })],
    ["negative violations", version({ validations: [hardValidation({ violationCount: -1 })] })],
    ["PASS with violations", version({ validations: [hardValidation({ violationCount: 1 })] })],
    ["invalid details", version({ validations: [hardValidation({ details: "none" })] })],
    ["malformed entry after a pass", version({ validations: [hardValidation(), null] })],
    ["duplicate validation codes", version({ validations: [hardValidation(), hardValidation()] })],
  ])("fails closed for %s", (_name, input) => {
    const result = getConfirmationEligibility(input);

    expect(result.eligible).toBe(false);
    expect(result.gateLabel).toBe("Blocked");
    if (input !== null && typeof input === "object") {
      expect(result.reason).toBe("INVALID_VALIDATION_DATA");
    } else {
      expect(result.reason).toBe("NO_VERSION");
    }
  });
});

describe("parseConfirmationSuccess", () => {
  it("accepts a matching, explicit confirmation response", () => {
    expect(
      parseConfirmationSuccess(
        {
          confirmed: true,
          persisted: false,
          versionId: "version-1",
          confirmedAt: "2026-07-16T12:00:00.000Z",
          message: "Confirmed.",
        },
        "version-1",
      ),
    ).toEqual({
      confirmed: true,
      persisted: false,
      versionId: "version-1",
      confirmedAt: "2026-07-16T12:00:00.000Z",
      message: "Confirmed.",
    });
  });

  it.each([
    ["empty body", {}],
    ["negative confirmation", { confirmed: false, persisted: false, versionId: "version-1", confirmedAt: "now" }],
    ["missing persisted flag", { confirmed: true, versionId: "version-1", confirmedAt: "now" }],
    ["mismatched version", { confirmed: true, persisted: false, versionId: "version-2", confirmedAt: "now" }],
    ["missing timestamp", { confirmed: true, persisted: false, versionId: "version-1" }],
    ["invalid message", { confirmed: true, persisted: false, versionId: "version-1", confirmedAt: "now", message: 1 }],
  ])("rejects a 2xx-shaped response with %s", (_name, response) => {
    expect(parseConfirmationSuccess(response, "version-1")).toBeNull();
  });
});

describe("getConfirmationGatePresentation", () => {
  it("shows Ready only for eligible evidence", () => {
    expect(getConfirmationGatePresentation(version())).toMatchObject({
      state: "READY",
      className: "is-clear",
      label: "Ready",
      summary: "1/1 hard rules",
    });
  });

  it("shows an explicit blocked state instead of Ready 0/0", () => {
    const presentation = getConfirmationGatePresentation(version({ validations: [] }));

    expect(presentation).toMatchObject({
      state: "BLOCKED",
      className: "is-blocked",
      label: "Blocked",
      summary: "No hard-validation evidence",
    });
    expect(`${presentation.label} ${presentation.summary}`).not.toContain("Ready 0/0");
  });

  it("shows a locked terminal state for a safely confirmed version", () => {
    expect(getConfirmationGatePresentation(version({ status: "CONFIRMED" }))).toMatchObject({
      state: "CONFIRMED",
      className: "is-clear",
      label: "Confirmed",
      summary: "1/1 hard rules | Locked",
    });
  });

  it("keeps malformed confirmed evidence blocked", () => {
    expect(
      getConfirmationGatePresentation(version({ status: "CONFIRMED", validations: [] })),
    ).toMatchObject({
      state: "BLOCKED",
      className: "is-blocked",
      label: "Blocked",
    });
  });
});
