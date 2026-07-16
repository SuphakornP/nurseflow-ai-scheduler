import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/request";
import { getCachedSchedule } from "@/lib/schedule-cache";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminRequest(request);
  if (!auth.ok) return auth.response;

  const periodId = new URL(request.url).searchParams.get("periodId");
  if (!periodId) {
    return NextResponse.json(
      { error: "PERIOD_REQUIRED", message: "Provide a periodId query parameter." },
      { status: 400 },
    );
  }
  const schedule = getCachedSchedule(periodId);
  if (isSupabaseConfigured()) {
    const supabase = createAdminClient();
    const periodQuery = supabase
      .from("schedule_periods")
      .select(
        "id, department_id, code, name, schedule_start_date, schedule_end_date, status, confirmed_version_id, confirmed_at, confirmed_by_nickname",
      )
      .eq("is_active", true)
      .is("deleted_at", null);
    const reference = schedule?.dataset.period.code ?? periodId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
    const { data: persistedPeriod, error: periodError } = await (isUuid
      ? periodQuery.eq("id", reference)
      : periodQuery.eq("code", reference)
    ).maybeSingle();
    if (periodError) {
      return NextResponse.json(
        {
          error: "HISTORY_QUERY_FAILED",
          message: "Schedule history is temporarily unavailable. Try again shortly.",
        },
        { status: 500 },
      );
    }
    if (persistedPeriod) {
      const [versionsResult, metricsResult, exportsResult] = await Promise.all([
        supabase
          .from("schedule_versions")
          .select(
            "id, version_no, name, status, solver_status, objective_score, created_at, confirmed_at, confirmed_by_nickname",
          )
          .eq("schedule_period_id", persistedPeriod.id)
          .eq("department_id", persistedPeriod.department_id)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("version_no"),
        supabase
          .from("schedule_version_metrics")
          .select("schedule_version_id, metric_code, metric_value")
          .eq("schedule_period_id", persistedPeriod.id)
          .eq("department_id", persistedPeriod.department_id)
          .eq("is_active", true)
          .is("deleted_at", null),
        supabase
          .from("schedule_exports")
          .select("id, schedule_version_id, export_format, file_name, exported_at")
          .eq("schedule_period_id", persistedPeriod.id)
          .eq("department_id", persistedPeriod.department_id)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("exported_at", { ascending: false }),
      ]);
      const queryError = versionsResult.error ?? metricsResult.error ?? exportsResult.error;
      if (queryError) {
        return NextResponse.json(
          {
            error: "HISTORY_QUERY_FAILED",
            message: "Schedule history is temporarily unavailable. Try again shortly.",
          },
          { status: 500 },
        );
      }
      const metricsByVersion = new Map<string, Record<string, number | null>>();
      for (const metric of metricsResult.data ?? []) {
        const current = metricsByVersion.get(metric.schedule_version_id) ?? {};
        current[metric.metric_code] = metric.metric_value;
        metricsByVersion.set(metric.schedule_version_id, current);
      }
      return NextResponse.json({
        period: persistedPeriod,
        versions: (versionsResult.data ?? []).map((version) => ({
          ...version,
          metrics: metricsByVersion.get(version.id) ?? {},
          exportEndpoint: `/api/export`,
        })),
        exports: exportsResult.data ?? [],
        persistenceMode: "SUPABASE",
      });
    }
  }
  if (!schedule) return NextResponse.json({ versions: [], persistenceMode: "LOCAL_DEMO" });
  return NextResponse.json({
    period: schedule.dataset.period,
    versions: schedule.versions.map((version) => ({
      id: version.id,
      versionNo: version.versionNo,
      name: version.name,
      status: version.status,
      solverStatus: version.solverStatus,
      generatedAt: version.generatedAt,
      confirmedAt: version.confirmedAt,
      metrics: version.metrics,
    })),
    persistenceMode: "LOCAL_DEMO",
  });
}
