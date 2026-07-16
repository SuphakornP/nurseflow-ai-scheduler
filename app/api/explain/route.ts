import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { explainScheduleOutcome } from "@/lib/openai-explanation";

const RequestSchema = z.object({
  periodId: z.string().min(1).max(100),
  nurseNickname: z.string().min(1).max(32),
  date: z.iso.date(),
  requested: z.string().min(1).max(30),
  assigned: z.string().min(1).max(20),
  reasonCode: z.string().min(1).max(100),
  facts: z.array(z.string().max(250)).max(8).default([]),
});

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_EXPLANATION_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await explainScheduleOutcome(parsed.data));
  } catch {
    return NextResponse.json(
      {
        error: "OPENAI_EXPLANATION_FAILED",
        message: "AI explanation is temporarily unavailable. The solver reason remains available.",
      },
      { status: 502 },
    );
  }
}
