import "server-only";

const DEFAULT_SOLVER_URL = "http://127.0.0.1:8000";
const SOLVER_TOKEN_MIN_LENGTH = 32;
const MAX_SOLVER_ERROR_BODY_CHARS = 64 * 1024;

const SOLVER_TOP_LEVEL_FIELDS = new Set([
  "period_name",
  "period_start",
  "period_end",
  "nurses",
  "requests",
  "previous_assignments",
  "rules",
  "optimization_profile",
  "time_limit_seconds",
  "random_seed",
]);

export type SolverRejectionReason =
  | "EDUCATION_MODE"
  | "FLEXIBLE_REQUEST_MODE"
  | "INPUT_PROBLEM"
  | "PAYLOAD_VALIDATION"
  | "REQUIRED_REQUEST_MODE"
  | "STAFFING_PREFLIGHT"
  | "UNRESOLVED_REQUEST"
  | "VACATION_MODE";

export interface SolverRejectionDiagnostic {
  kind: "input_problem" | "schema_validation" | "upstream_rejection";
  issueCount: number;
  reasonCodes: SolverRejectionReason[];
  fieldPaths: string[];
  issueTypes: string[];
}

export class SolverUnavailableError extends Error {
  readonly status?: number;

  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options);
    this.name = "SolverUnavailableError";
    this.status = options?.status;
  }
}

export class SolverRejectedError extends Error {
  readonly path: string;
  readonly status: 422;
  readonly diagnostic: SolverRejectionDiagnostic;

  constructor(path: string, diagnostic: SolverRejectionDiagnostic) {
    super("Scheduling service rejected the normalized input.");
    this.name = "SolverRejectedError";
    this.path = path;
    this.status = 422;
    this.diagnostic = diagnostic;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reasonForMessage(message: string): SolverRejectionReason {
  if (/needs review/i.test(message)) return "UNRESOLVED_REQUEST";
  if (/Vacation must use LOCKED/i.test(message)) return "VACATION_MODE";
  if (/Education must be LOCKED/i.test(message)) return "EDUCATION_MODE";
  if (/O\/D and O\/N must use REQUIRED/i.test(message)) {
    return "FLEXIBLE_REQUEST_MODE";
  }
  if (/REQUIRED mode needs/i.test(message)) return "REQUIRED_REQUEST_MODE";
  if (/not enough nurses|needs at least|staffing target/i.test(message)) {
    return "STAFFING_PREFLIGHT";
  }
  return "INPUT_PROBLEM";
}

function safeTopLevelPath(location: unknown): string | null {
  if (!Array.isArray(location)) return null;
  const field = location.find(
    (segment): segment is string =>
      typeof segment === "string" && SOLVER_TOP_LEVEL_FIELDS.has(segment),
  );
  if (!field) return null;
  return location.some((segment) => typeof segment === "number")
    ? `${field}[]`
    : field;
}

function boundedUnique(values: string[], maximum = 12) {
  return [...new Set(values)].slice(0, maximum);
}

function rejectionDiagnostic(payload: unknown): SolverRejectionDiagnostic {
  const detail = isRecord(payload) ? payload.detail : null;

  if (Array.isArray(detail)) {
    const issues = detail.filter(isRecord);
    return {
      kind: "schema_validation",
      issueCount: Math.max(issues.length, 1),
      reasonCodes: ["PAYLOAD_VALIDATION"],
      fieldPaths: boundedUnique(
        issues.flatMap((issue) => {
          const path = safeTopLevelPath(issue.loc);
          return path ? [path] : [];
        }),
      ),
      issueTypes: boundedUnique(
        issues.flatMap((issue) =>
          typeof issue.type === "string" && /^[a-z0-9_.-]{1,64}$/i.test(issue.type)
            ? [issue.type]
            : [],
        ),
      ),
    };
  }

  if (isRecord(detail)) {
    const safeReasonCodes = Array.isArray(detail.reason_codes)
      ? detail.reason_codes.filter(
          (value): value is SolverRejectionReason =>
            typeof value === "string" &&
            [
              "EDUCATION_MODE",
              "FLEXIBLE_REQUEST_MODE",
              "INPUT_PROBLEM",
              "PAYLOAD_VALIDATION",
              "REQUIRED_REQUEST_MODE",
              "STAFFING_PREFLIGHT",
              "UNRESOLVED_REQUEST",
              "VACATION_MODE",
            ].includes(value),
        )
      : [];
    const safeFieldPaths = Array.isArray(detail.field_paths)
      ? detail.field_paths.filter(
          (value): value is string =>
            typeof value === "string" &&
            SOLVER_TOP_LEVEL_FIELDS.has(value.replace(/\[\]$/, "")) &&
            /^(?:[a-z_]+)(?:\[\])?$/.test(value),
        )
      : [];
    const safeIssueTypes = Array.isArray(detail.issue_types)
      ? detail.issue_types.filter(
          (value): value is string =>
            typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value),
        )
      : [];
    const rawErrors = Array.isArray(detail.errors)
      ? detail.errors.filter((value): value is string => typeof value === "string")
      : [];
    const issueCount =
      typeof detail.issue_count === "number" && Number.isSafeInteger(detail.issue_count)
        ? Math.max(1, Math.min(detail.issue_count, 10_000))
        : Math.max(rawErrors.length, 1);
    return {
      kind: safeReasonCodes.includes("PAYLOAD_VALIDATION")
        ? "schema_validation"
        : "input_problem",
      issueCount,
      reasonCodes: boundedUnique(
        safeReasonCodes.length
          ? safeReasonCodes
          : rawErrors.map(reasonForMessage),
      ) as SolverRejectionReason[],
      fieldPaths: boundedUnique(safeFieldPaths),
      issueTypes: boundedUnique(safeIssueTypes),
    };
  }

  return {
    kind: "upstream_rejection",
    issueCount: 1,
    reasonCodes: ["INPUT_PROBLEM"],
    fieldPaths: [],
    issueTypes: [],
  };
}

async function solverRejectedError(path: string, response: Response) {
  let payload: unknown = null;
  try {
    const body = await response.text();
    if (body.length <= MAX_SOLVER_ERROR_BODY_CHARS) payload = JSON.parse(body);
  } catch {
    // The public diagnostic remains generic when the upstream body is malformed.
  }
  return new SolverRejectedError(path, rejectionDiagnostic(payload));
}

function solverApiToken(): string {
  const token = process.env.SOLVER_API_TOKEN;
  if (!token || token.length < SOLVER_TOKEN_MIN_LENGTH) {
    throw new SolverUnavailableError("Scheduling service authentication is not configured.");
  }
  return token;
}

function solverHeaders(path: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (path !== "/health") {
    headers.set("authorization", `Bearer ${solverApiToken()}`);
  }
  return headers;
}

export async function callSolver<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 90_000,
): Promise<T> {
  const baseUrl = process.env.SOLVER_API_URL || DEFAULT_SOLVER_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: solverHeaders(path, init),
    });
    if (response.status === 422) {
      throw await solverRejectedError(path, response);
    }
    if (!response.ok) {
      throw new SolverUnavailableError(
        `Scheduling service rejected the request with status ${response.status}.`,
        { status: response.status },
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (
      error instanceof SolverUnavailableError ||
      error instanceof SolverRejectedError
    ) {
      throw error;
    }
    throw new SolverUnavailableError(
      "Scheduling service is unavailable. Start it with npm run dev:solver.",
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function callSolverBinary(
  path: string,
  body: unknown,
  timeoutMs = 90_000,
) {
  const baseUrl = process.env.SOLVER_API_URL || DEFAULT_SOLVER_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: solverHeaders(path, { body: "present" }),
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new SolverUnavailableError(
        `Export service rejected the request with status ${response.status}.`,
      );
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType:
        response.headers.get("content-type") ||
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName:
        response.headers
          .get("content-disposition")
          ?.match(/filename="?([^";]+)"?/i)?.[1] ||
        response.headers.get("x-filename") ||
        "nurseflow-schedule.xlsx",
    };
  } catch (error) {
    if (error instanceof SolverUnavailableError) throw error;
    throw new SolverUnavailableError("Export service is unavailable.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
