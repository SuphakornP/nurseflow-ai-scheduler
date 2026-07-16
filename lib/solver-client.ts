import "server-only";

const DEFAULT_SOLVER_URL = "http://127.0.0.1:8000";
const SOLVER_TOKEN_MIN_LENGTH = 32;

export class SolverUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SolverUnavailableError";
  }
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
    if (!response.ok) {
      throw new SolverUnavailableError(
        `Scheduling service rejected the request with status ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SolverUnavailableError) throw error;
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
