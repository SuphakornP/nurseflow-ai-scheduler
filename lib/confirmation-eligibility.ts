import type { ConstraintResult } from "@/lib/types";

const CONFIRMABLE_SOLVER_STATUSES = new Set(["OPTIMAL", "FEASIBLE", "DEMO"]);
const VALIDATION_TYPES = new Set(["HARD", "SOFT"]);
const VALIDATION_STATUSES = new Set(["PASS", "FAIL", "WARNING"]);

export type ConfirmationBlockReason =
  | "NO_VERSION"
  | "INVALID_VALIDATION_DATA"
  | "VERSION_NOT_VALID"
  | "INVALID_SOLVER_STATUS"
  | "SOLVER_INFEASIBLE"
  | "NO_HARD_VALIDATIONS"
  | "HARD_VALIDATION_FAILED";

interface ConfirmationEvidence {
  hardPassed: number;
  hardTotal: number;
  validations: readonly ConstraintResult[];
  failedHardRuleCodes: readonly string[];
}

export type ConfirmationEligibility = ConfirmationEvidence &
  (
    | {
        eligible: true;
        reason: null;
        gateLabel: "Ready";
        summary: string;
        message: string;
      }
    | {
        eligible: false;
        reason: ConfirmationBlockReason;
        gateLabel: "Blocked";
        summary: string;
        message: string;
      }
  );

export interface ConfirmationSuccess {
  confirmed: true;
  persisted: boolean;
  versionId: string;
  confirmedAt: string;
  message?: string;
}

export interface ConfirmationGatePresentation {
  state: "READY" | "BLOCKED" | "CONFIRMED";
  className: "is-clear" | "is-blocked";
  label: "Ready" | "Blocked" | "Confirmed";
  summary: string;
  description: string;
  disabledReason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseConfirmationSuccess(
  value: unknown,
  expectedVersionId: string,
): ConfirmationSuccess | null {
  if (!isRecord(value)) return null;
  if (value.confirmed !== true || typeof value.persisted !== "boolean") return null;
  if (value.versionId !== expectedVersionId || !isNonEmptyString(value.confirmedAt)) return null;
  if (value.message !== undefined && typeof value.message !== "string") return null;

  return {
    confirmed: true,
    persisted: value.persisted,
    versionId: value.versionId,
    confirmedAt: value.confirmedAt,
    ...(value.message === undefined ? {} : { message: value.message }),
  };
}

function isConstraintResult(value: unknown): value is ConstraintResult {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.code) || !isNonEmptyString(value.name)) return false;
  if (typeof value.type !== "string" || !VALIDATION_TYPES.has(value.type)) return false;
  if (typeof value.status !== "string" || !VALIDATION_STATUSES.has(value.status)) return false;
  if (
    typeof value.violationCount !== "number" ||
    !Number.isInteger(value.violationCount) ||
    value.violationCount < 0
  ) {
    return false;
  }
  if (!Array.isArray(value.details) || !value.details.every((detail) => typeof detail === "string")) {
    return false;
  }

  // A PASS result that reports violations is internally inconsistent evidence.
  return value.status !== "PASS" || value.violationCount === 0;
}

function blocked(
  reason: ConfirmationBlockReason,
  summary: string,
  message: string,
  evidence: Partial<ConfirmationEvidence> = {},
): ConfirmationEligibility {
  return {
    eligible: false,
    reason,
    gateLabel: "Blocked",
    summary,
    message,
    hardPassed: evidence.hardPassed ?? 0,
    hardTotal: evidence.hardTotal ?? 0,
    validations: evidence.validations ?? [],
    failedHardRuleCodes: evidence.failedHardRuleCodes ?? [],
  };
}

export function getConfirmationEligibility(value: unknown): ConfirmationEligibility {
  if (!isRecord(value)) {
    return blocked(
      "NO_VERSION",
      "No schedule version selected",
      "Confirmation is blocked because no schedule version is selected.",
    );
  }

  if (!Array.isArray(value.validations) || !value.validations.every(isConstraintResult)) {
    return blocked(
      "INVALID_VALIDATION_DATA",
      "Validation evidence invalid",
      "Confirmation is blocked because the validation evidence is missing or invalid.",
    );
  }

  const validations = value.validations;
  if (new Set(validations.map((validation) => validation.code)).size !== validations.length) {
    return blocked(
      "INVALID_VALIDATION_DATA",
      "Validation evidence invalid",
      "Confirmation is blocked because the validation evidence is missing or invalid.",
    );
  }
  const hardValidations = validations.filter((validation) => validation.type === "HARD");
  const passedHardValidations = hardValidations.filter(
    (validation) => validation.status === "PASS" && validation.violationCount === 0,
  );
  const failedHardValidations = hardValidations.filter(
    (validation) => validation.status !== "PASS" || validation.violationCount !== 0,
  );
  const evidence: ConfirmationEvidence = {
    hardPassed: passedHardValidations.length,
    hardTotal: hardValidations.length,
    validations,
    failedHardRuleCodes: failedHardValidations.map((validation) => validation.code),
  };

  if (value.status !== "VALID") {
    return blocked(
      "VERSION_NOT_VALID",
      "Solver result is not VALID",
      "Confirmation is blocked because the selected solver result is not VALID.",
      evidence,
    );
  }

  if (value.solverStatus === "INFEASIBLE") {
    return blocked(
      "SOLVER_INFEASIBLE",
      "Solver result is INFEASIBLE",
      "Confirmation is blocked because the solver result is INFEASIBLE.",
      evidence,
    );
  }

  if (
    typeof value.solverStatus !== "string" ||
    !CONFIRMABLE_SOLVER_STATUSES.has(value.solverStatus)
  ) {
    return blocked(
      "INVALID_SOLVER_STATUS",
      "Solver status is invalid",
      "Confirmation is blocked because the solver status is missing or invalid.",
      evidence,
    );
  }

  if (hardValidations.length === 0) {
    return blocked(
      "NO_HARD_VALIDATIONS",
      "No hard-validation evidence",
      "Confirmation is blocked because no hard-validation evidence is available.",
      evidence,
    );
  }

  if (failedHardValidations.length > 0) {
    return blocked(
      "HARD_VALIDATION_FAILED",
      `${passedHardValidations.length}/${hardValidations.length} hard rules`,
      "Confirmation is blocked because one or more hard validations did not pass.",
      evidence,
    );
  }

  return {
    eligible: true,
    reason: null,
    gateLabel: "Ready",
    summary: `${passedHardValidations.length}/${hardValidations.length} hard rules`,
    message: "The selected solver result has complete, passing hard-validation evidence.",
    ...evidence,
  };
}

export function getConfirmationGatePresentation(value: unknown): ConfirmationGatePresentation {
  const eligibility = getConfirmationEligibility(value);
  if (eligibility.eligible) {
    return {
      state: "READY",
      className: "is-clear",
      label: "Ready",
      summary: eligibility.summary,
      description:
        "Confirmation requires a VALID solver result with complete passing hard-validation evidence.",
      disabledReason: "",
    };
  }

  if (isRecord(value) && value.status === "CONFIRMED") {
    const confirmedEvidence = getConfirmationEligibility({ ...value, status: "VALID" });
    if (confirmedEvidence.eligible) {
      return {
        state: "CONFIRMED",
        className: "is-clear",
        label: "Confirmed",
        summary: `${confirmedEvidence.hardPassed}/${confirmedEvidence.hardTotal} hard rules | Locked`,
        description: "This validated version is confirmed and locked for this session.",
        disabledReason: "This version is already confirmed.",
      };
    }
  }

  return {
    state: "BLOCKED",
    className: "is-blocked",
    label: "Blocked",
    summary: eligibility.summary,
    description:
      "Confirmation requires a VALID solver result with complete passing hard-validation evidence.",
    disabledReason: eligibility.summary,
  };
}
