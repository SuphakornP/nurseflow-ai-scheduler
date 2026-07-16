import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { callSolverBinary, SolverUnavailableError } from "@/lib/solver-client";
import { getCachedSchedule } from "@/lib/schedule-cache";
import { datasetToSolverProblem, versionToSolverAssignments } from "@/lib/solver-adapter";
import { isSupabaseConfigured } from "@/lib/supabase/admin";
import { loadPersistedVersionForExport } from "@/lib/supabase/persisted-export";

export const maxDuration = 120;

const RequestSchema = z
  .object({
    periodId: z.string().min(1).max(120),
    versionId: z.string().min(1).max(160),
  })
  .strict();

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_EXPORT_REQUEST", message: "A schedule version is required." },
      { status: 400 },
    );
  }
  const body = parsed.data;
  try {
    const cached = getCachedSchedule(body.periodId);
    const version = cached?.versions.find((item) => item.id === body.versionId);
    const persisted = !version && isSupabaseConfigured()
      ? await loadPersistedVersionForExport(body.versionId)
      : null;
    if (!version && !persisted) {
      return NextResponse.json(
        {
          error: "VERSION_NOT_FOUND",
          message: "Regenerate the schedule or provide a persisted Supabase version ID.",
        },
        { status: 404 },
      );
    }
    const file = await callSolverBinary(
      "/export",
      version && cached
        ? {
            problem: datasetToSolverProblem(cached.dataset, "balanced"),
            assignments: versionToSolverAssignments(cached.dataset, version),
          }
        : persisted,
    );
    return new NextResponse(file.bytes, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.fileName.replaceAll('"', "")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const serviceUnavailable = error instanceof SolverUnavailableError;
    return NextResponse.json(
      {
        error: "EXPORT_FAILED",
        message: serviceUnavailable
          ? "The export service is temporarily unavailable. Try again shortly."
          : "The workbook could not be exported. Verify the selected schedule version and try again.",
      },
      { status: serviceUnavailable ? 503 : 500 },
    );
  }
}
