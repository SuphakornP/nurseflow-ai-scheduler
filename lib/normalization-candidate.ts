import type { ShiftCode } from "@/lib/types";

const ASSIGNMENTS_BY_TYPE: Record<string, ShiftCode[]> = {
  OFF_REQUEST: ["OFF"],
  OFF_OR_DAY: ["OFF", "D"],
  OFF_OR_NIGHT: ["OFF", "N"],
  DAY_OR_NIGHT: ["D", "N"],
  VACATION: ["VAC"],
  EDUCATION: ["ED"],
};

/**
 * Keep type and assignments inseparable even when an AI candidate returns a
 * structurally valid but semantically inconsistent pair.
 */
export function assignmentsForNormalizationCandidate(
  candidate: Record<string, unknown>,
  fallback: ShiftCode[],
): ShiftCode[] {
  const normalizedType = candidate.normalizedType;
  if (typeof normalizedType !== "string") return fallback;
  return ASSIGNMENTS_BY_TYPE[normalizedType] ?? fallback;
}
