import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/request";
import { callSolver, SolverUnavailableError } from "@/lib/solver-client";
import { cacheSchedule } from "@/lib/schedule-cache";
import {
  datasetToSolverProblem,
  makeGenerateResponse,
  solverProblemToDataset,
  solverResultToVersion,
  type OptimizationProfile,
  type SolverDemoProblem,
  type SolverGenerateResponse,
} from "@/lib/solver-adapter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  try {
    const problem = await callSolver<SolverDemoProblem>("/demo");
    const dataset = solverProblemToDataset(problem);
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
        error: "SOLVER_UNAVAILABLE",
        message: serviceUnavailable
          ? "Demo schedule generation is temporarily unavailable. Try again shortly."
          : "The demo schedule could not be prepared. Try again.",
      },
      { status: serviceUnavailable ? 503 : 500 },
    );
  }
}
