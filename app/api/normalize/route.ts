import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import { suggestNormalizations } from "@/lib/openai-normalization";

const RequestSchema = z.object({
  periodId: z.string().min(1).max(100),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        rawValue: z.string().max(100),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_NORMALIZATION_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({
      candidates: await suggestNormalizations(parsed.data.periodId, parsed.data.items),
    });
  } catch {
    return NextResponse.json(
      {
        error: "OPENAI_NORMALIZATION_FAILED",
        message: "AI normalization is temporarily unavailable. Review ambiguous values manually.",
      },
      { status: 502 },
    );
  }
}
