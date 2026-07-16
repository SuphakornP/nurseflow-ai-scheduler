import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/request";
import { callSolver } from "@/lib/solver-client";
import { isSupabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminRequest(request);
  if (!auth.ok) return auth.response;

  let solver: { status: string } = { status: "unavailable" };
  try {
    await callSolver<Record<string, unknown>>("/health", undefined, 3_000);
    solver = { status: "ready" };
  } catch {
    solver = { status: "unavailable" };
  }
  return NextResponse.json({
    status: solver.status === "ready" ? "ready" : "degraded",
    services: {
      solver,
      openai: {
        status: process.env.OPENAI_API_KEY ? "configured" : "deterministic_fallback",
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      },
      supabase: {
        status: isSupabaseConfigured() ? "configured" : "local_demo",
      },
    },
  });
}
