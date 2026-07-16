import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const ExplanationSchema = z.object({
  headline: z.string().max(120),
  explanation: z.string().max(700),
  evidence: z.array(z.string().max(180)).max(4),
  nextBestAction: z.string().max(220).nullable(),
});

export type Explanation = z.infer<typeof ExplanationSchema> & {
  provider: "openai" | "deterministic";
  model: string;
};

interface ExplanationInput {
  periodId: string;
  nurseNickname: string;
  date: string;
  requested: string;
  assigned: string;
  reasonCode: string;
  facts: string[];
}

function deterministicExplanation(input: ExplanationInput): Explanation {
  const facts = input.facts.length
    ? input.facts
    : [`Assigned ${input.assigned} to preserve daily staffing and sequence rules.`];
  return {
    headline: `${input.requested} request not selected`,
    explanation: `${input.nurseNickname}'s request on ${input.date} was not selected. The optimizer assigned ${input.assigned} because ${input.reasonCode.replaceAll("_", " ").toLowerCase()}.`,
    evidence: facts.slice(0, 4),
    nextBestAction: "Compare another valid version or add an explicit scheduling preference and regenerate.",
    provider: "deterministic",
    model: "rules-engine",
  };
}

export async function explainScheduleOutcome(input: ExplanationInput): Promise<Explanation> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  if (!apiKey) return deterministicExplanation(input);

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model,
    store: false,
    safety_identifier: createHash("sha256")
      .update(`nurseflow:${input.periodId}:${input.nurseNickname}`)
      .digest("hex")
      .slice(0, 32),
    reasoning: { effort: "low" },
    instructions:
      "You explain an ICU scheduling optimizer to a nurse scheduler. Use only the supplied structured facts. Do not infer clinical or personal information. Be concise, neutral, and actionable. Never claim the language model created the roster; the CP-SAT optimizer did.",
    input: [
      {
        role: "user",
        content: JSON.stringify({
          nickname: input.nurseNickname,
          date: input.date,
          requested: input.requested,
          assigned: input.assigned,
          reasonCode: input.reasonCode,
          solverFacts: input.facts,
        }),
      },
    ],
    text: {
      format: zodTextFormat(ExplanationSchema, "schedule_explanation"),
      verbosity: "low",
    },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no structured explanation.");
  }
  return { ...response.output_parsed, provider: "openai", model };
}
