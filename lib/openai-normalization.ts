import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const CandidateSchema = z.object({
  id: z.string(),
  normalizedType: z.enum([
    "OFF_REQUEST",
    "OFF_OR_DAY",
    "OFF_OR_NIGHT",
    "DAY_OR_NIGHT",
    "VACATION",
    "EDUCATION",
    "UNKNOWN",
  ]),
  priority: z.number().int().min(1).max(4).nullable(),
  allowedAssignments: z.array(z.enum(["D", "N", "OFF", "VAC", "ED"])).max(3),
  confidence: z.number().min(0).max(1),
  note: z.string().max(220),
  requiresHumanReview: z.boolean(),
});

const ResultSchema = z.object({ candidates: z.array(CandidateSchema).max(100) });
export type NormalizationCandidate = z.infer<typeof CandidateSchema> & {
  provider: "openai" | "deterministic";
};

interface AmbiguousValue {
  id: string;
  rawValue: string;
}

function deterministicCandidate(item: AmbiguousValue): NormalizationCandidate {
  const cleaned = item.rawValue.normalize("NFKC").trim().toUpperCase();
  if (/^O[1-4]\/N$/.test(cleaned)) {
    return {
      id: item.id,
      normalizedType: "OFF_OR_NIGHT",
      priority: Number(cleaned[1]),
      allowedAssignments: ["OFF", "N"],
      confidence: 0.75,
      note: "Likely an OFF request with priority or a Night assignment.",
      requiresHumanReview: true,
      provider: "deterministic",
    };
  }
  if (cleaned === "D/N") {
    return {
      id: item.id,
      normalizedType: "DAY_OR_NIGHT",
      priority: null,
      allowedAssignments: ["D", "N"],
      confidence: 0.8,
      note: "Likely Day or Night; confirm that OFF is not allowed.",
      requiresHumanReview: true,
      provider: "deterministic",
    };
  }
  if (cleaned === "VAC1") {
    return {
      id: item.id,
      normalizedType: "VACATION",
      priority: null,
      allowedAssignments: ["VAC"],
      confidence: 0.65,
      note: "Likely Vacation, but the numeric suffix is not part of the approved vocabulary.",
      requiresHumanReview: true,
      provider: "deterministic",
    };
  }
  return {
    id: item.id,
    normalizedType: "UNKNOWN",
    priority: null,
    allowedAssignments: [],
    confidence: 0,
    note: "No safe deterministic interpretation is available.",
    requiresHumanReview: true,
    provider: "deterministic",
  };
}

export async function suggestNormalizations(periodId: string, items: AmbiguousValue[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  if (!apiKey) return items.map(deterministicCandidate);

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model,
    store: false,
    safety_identifier: createHash("sha256")
      .update(`nurseflow:normalize:${periodId}`)
      .digest("hex")
      .slice(0, 32),
    reasoning: { effort: "low" },
    instructions:
      "Normalize only the provided nurse scheduling tokens. Never infer employee identity or personal information. Every token is a nurse preference, not an immutable assignment; VAC and ED mean requested Vacation and Education. O1-O4 are OFF priorities. O/D and O/N are preferred flexible sets. Mark every non-standard token for human review even when the interpretation is likely. Preserve each input id exactly.",
    input: [{ role: "user", content: JSON.stringify({ ambiguousTokens: items }) }],
    text: { format: zodTextFormat(ResultSchema, "normalization_candidates"), verbosity: "low" },
  });
  if (!response.output_parsed) throw new Error("OpenAI returned no normalization candidates.");
  return response.output_parsed.candidates.map((candidate) => ({
    ...candidate,
    provider: "openai" as const,
  }));
}
