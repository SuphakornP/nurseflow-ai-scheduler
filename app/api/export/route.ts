import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { getConfirmationEligibility } from "@/lib/confirmation-eligibility";
import { callSolverBinary, SolverUnavailableError } from "@/lib/solver-client";
import { getCachedCandidate } from "@/lib/schedule-cache";
import { datasetToSolverProblem, versionToSolverAssignments } from "@/lib/solver-adapter";
import { getSourceWorkbookTemplate } from "@/lib/source-workbook-cache";
import { sourceWorkbookTemplateToSolverPayload } from "@/lib/source-workbook-template";

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
    const cached = getCachedCandidate(auth.session.sessionId, body.periodId, body.versionId);
    if (!cached) {
      return NextResponse.json(
        {
          error: "VERSION_NOT_FOUND",
          message: "Regenerate the schedule before exporting it.",
        },
        { status: 404 },
      );
    }
    const { dataset, version } = cached;
    if (!getConfirmationEligibility(version).eligible) {
      return NextResponse.json(
        {
          error: "VERSION_NOT_EXPORTABLE",
          message: "Only a VALID schedule with complete passing hard-validation evidence can be exported.",
        },
        { status: 409 },
      );
    }
    let sourceTemplate: ReturnType<typeof getSourceWorkbookTemplate> = null;
    if (dataset.sourceWorkbookHash || dataset.nurses.some((nurse) => !nurse.synthetic)) {
      if (!dataset.sourceWorkbookHash) {
        return NextResponse.json(
          {
            error: "SOURCE_TEMPLATE_NOT_BOUND",
            message: "Re-import the source workbook and generate candidates before exporting.",
          },
          { status: 409 },
        );
      }
      sourceTemplate = getSourceWorkbookTemplate(
        auth.session.sessionId,
        body.periodId,
        dataset.sourceWorkbookHash,
      );
      if (!sourceTemplate) {
        return NextResponse.json(
          {
            error: "SOURCE_TEMPLATE_NOT_AVAILABLE",
            message: "Re-import the source workbook and generate candidates before exporting.",
          },
          { status: 409 },
        );
      }
    }
    const file = await callSolverBinary("/export", {
      problem: datasetToSolverProblem(dataset, "balanced"),
      assignments: versionToSolverAssignments(dataset, version),
      ...(sourceTemplate
        ? { source_workbook_template: sourceWorkbookTemplateToSolverPayload(sourceTemplate) }
        : {}),
    });
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
