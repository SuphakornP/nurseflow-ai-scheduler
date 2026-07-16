import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/request";
import { callSolver, SolverUnavailableError } from "@/lib/solver-client";
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

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

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

  try {
    const profiles: OptimizationProfile[] = ["requests_first", "balanced", "minimize_l0"];
    const results = await Promise.all(
      profiles.map((profile) =>
        callSolver<SolverGenerateResponse>("/generate", {
          method: "POST",
          body: JSON.stringify(datasetToSolverProblem(dataset, profile)),
        }),
      ),
    );
    const versions = results.map((result, index) =>
      solverResultToVersion(dataset, result, profiles[index], index + 1),
    );
    const response = makeGenerateResponse(dataset, versions);
    cacheSchedule(response);
    return NextResponse.json(response);
  } catch (error) {
    const serviceUnavailable = error instanceof SolverUnavailableError;
    return NextResponse.json(
      {
        error: "GENERATION_FAILED",
        message: serviceUnavailable
          ? "Schedule generation is temporarily unavailable. Try again shortly."
          : "The schedule could not be generated from this dataset. Review constraints and try again.",
      },
      { status: serviceUnavailable ? 503 : 422 },
    );
  }
}
