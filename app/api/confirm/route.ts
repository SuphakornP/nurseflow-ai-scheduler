import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { getConfirmationEligibility } from "@/lib/confirmation-eligibility";
import { getCachedCandidate } from "@/lib/schedule-cache";

const RequestSchema = z.object({
  periodId: z.string().min(1).max(120),
  versionId: z.string().min(1).max(160),
});

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_CONFIRM_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { periodId, versionId } = parsed.data;
  const cached = getCachedCandidate(auth.session.sessionId, periodId, versionId);
  if (!cached) {
    return NextResponse.json(
      { error: "VERSION_NOT_FOUND", message: "Regenerate the schedule before confirmation." },
      { status: 404 },
    );
  }
  const { version } = cached;
  const eligibility = getConfirmationEligibility(version);
  if (!eligibility.eligible) {
    const isHardFailure = eligibility.reason === "HARD_VALIDATION_FAILED";
    return NextResponse.json(
      {
        error: isHardFailure ? "HARD_CONSTRAINT_FAILURE" : "CONFIRMATION_NOT_ALLOWED",
        reason: eligibility.reason,
        message: eligibility.message,
        ...(isHardFailure ? { failedRules: eligibility.failedHardRuleCodes } : {}),
      },
      { status: 409 },
    );
  }

  const confirmation = cached.generation.confirmation ??= {
    versionId,
    confirmedAt: new Date().toISOString(),
  };
  if (confirmation.versionId !== versionId) {
    return NextResponse.json(
      {
        error: "GENERATION_ALREADY_CONFIRMED",
        message: "Another version is already confirmed for this calculation. Generate new candidates to choose again.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({
    confirmed: true,
    ...confirmation,
    message: `Version ${version.versionNo} is confirmed for this workspace. Download the Excel file to keep it.`,
  });
}
