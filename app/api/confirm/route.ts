import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { getCachedSchedule } from "@/lib/schedule-cache";
import { isSupabaseConfigured } from "@/lib/supabase/admin";
import { persistAndConfirmSchedule } from "@/lib/supabase/persistence";

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
  const cached = getCachedSchedule(parsed.data.periodId);
  const version = cached?.versions.find((item) => item.id === parsed.data.versionId);
  if (!cached || !version) {
    return NextResponse.json(
      { error: "VERSION_NOT_FOUND", message: "Regenerate the schedule before confirmation." },
      { status: 404 },
    );
  }
  const failedHardRules = version.validations.filter(
    (item) => item.type === "HARD" && item.status !== "PASS",
  );
  if (failedHardRules.length) {
    return NextResponse.json(
      {
        error: "HARD_CONSTRAINT_FAILURE",
        message: "A version with hard constraint failures cannot be confirmed.",
        failedRules: failedHardRules.map((item) => item.code),
      },
      { status: 409 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      confirmed: true,
      persisted: false,
      persistenceMode: "LOCAL_DEMO",
      versionId: version.id,
      confirmedAt: new Date().toISOString(),
      message: "Confirmed for this showcase session only. Configure Supabase to persist versions.",
    });
  }

  try {
    const persisted = await persistAndConfirmSchedule(
      cached,
      version,
      auth.session.displayName,
    );
    return NextResponse.json({
      confirmed: true,
      persisted: true,
      persistenceMode: "SUPABASE",
      versionId: version.id,
      persistedVersionId: persisted.scheduleVersionId,
      confirmedAt: persisted.confirmedAt,
      message: `Version ${version.versionNo} was validated, confirmed, and stored immutably in Supabase.`,
    });
  } catch {
    return NextResponse.json(
      {
        error: "SUPABASE_CONFIRM_FAILED",
        message: "The schedule could not be confirmed. Verify that the period is staged and try again.",
      },
      { status: 409 },
    );
  }
}
