import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/request";
import {
  callSolver,
  SolverRejectedError,
  SolverUnavailableError,
} from "@/lib/solver-client";
import { cacheSchedule } from "@/lib/schedule-cache";
import {
  datasetToSolverProblem,
  makeGenerateResponse,
  solverResultToVersion,
  type OptimizationProfile,
  type SolverGenerateResponse,
} from "@/lib/solver-adapter";
import { readBodyWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { ScheduleDatasetSchema } from "@/lib/schedule-schema";

export const maxDuration = 120;
const MAX_GENERATE_REQUEST_BYTES = 5 * 1024 * 1024;

function logProfileFailure(
  error: unknown,
  context: {
    requestId: string;
    profile: OptimizationProfile;
    durationMs: number;
    nurseCount: number;
    requestCount: number;
    previousAssignmentCount: number;
  },
) {
  const common = {
    event: "solver.generate.failed",
    requestId: context.requestId,
    profile: context.profile,
    durationMs: context.durationMs,
    nurseCount: context.nurseCount,
    requestCount: context.requestCount,
    previousAssignmentCount: context.previousAssignmentCount,
  };

  if (error instanceof SolverRejectedError) {
    console.warn(
      JSON.stringify({
        ...common,
        classification: "INPUT_REJECTED",
        retryable: false,
        upstreamStatus: error.status,
        upstreamPath: error.path,
        diagnostic: error.diagnostic,
      }),
    );
    return;
  }

  console.error(
    JSON.stringify({
      ...common,
      classification:
        error instanceof SolverUnavailableError ? "SOLVER_UNAVAILABLE" : "INTERNAL_ERROR",
      retryable: error instanceof SolverUnavailableError,
      upstreamStatus:
        error instanceof SolverUnavailableError ? (error.status ?? null) : null,
    }),
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  const requestId = crypto.randomUUID();

  let payload: unknown;
  try {
    const bytes = await readBodyWithLimit(request.body, MAX_GENERATE_REQUEST_BYTES);
    const text = new TextDecoder().decode(bytes);
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        {
          error: "GENERATION_REQUEST_TOO_LARGE",
          message: "The generation request exceeds 5 MB.",
        },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { error: "INVALID_JSON", message: "The generation request is not valid JSON." },
      { status: 400 },
    );
  }

  const parsed = ScheduleDatasetSchema.safeParse(
    typeof payload === "object" && payload !== null && "dataset" in payload
      ? payload.dataset
      : null,
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_DATASET", message: "A normalized schedule dataset is required." },
      { status: 400 },
    );
  }
  const dataset = parsed.data;
  const profiles: OptimizationProfile[] = ["requests_first", "balanced", "minimize_l0"];

  try {
    const results = await Promise.all(
      profiles.map(async (profile) => {
        const startedAt = performance.now();
        try {
          return await callSolver<SolverGenerateResponse>("/generate", {
            method: "POST",
            headers: { "x-request-id": requestId },
            body: JSON.stringify(datasetToSolverProblem(dataset, profile)),
          });
        } catch (error) {
          logProfileFailure(error, {
            requestId,
            profile,
            durationMs: Math.round(performance.now() - startedAt),
            nurseCount: dataset.nurses.length,
            requestCount: dataset.requests.length,
            previousAssignmentCount: dataset.previousAssignments.length,
          });
          throw error;
        }
      }),
    );
    const versions = results.map((result, index) =>
      solverResultToVersion(dataset, result, profiles[index], index + 1),
    );
    const response = makeGenerateResponse(dataset, versions);
    cacheSchedule(response);
    return NextResponse.json(response, { headers: { "x-request-id": requestId } });
  } catch (error) {
    const inputRejected = error instanceof SolverRejectedError;
    const serviceUnavailable = error instanceof SolverUnavailableError;
    return NextResponse.json(
      {
        error: inputRejected ? "SOLVER_INPUT_REJECTED" : "GENERATION_FAILED",
        message: inputRejected
          ? "The solver rejected the normalized request set. Review unresolved values and request rules, then try again."
          : serviceUnavailable
            ? "Schedule generation is temporarily unavailable. Try again shortly."
            : "The schedule could not be generated because of an internal error. Try again.",
      },
      {
        status: inputRejected ? 422 : serviceUnavailable ? 503 : 500,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
