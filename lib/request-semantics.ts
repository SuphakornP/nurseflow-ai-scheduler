import type {
  RequestConstraintMode,
  ShiftRequest,
  SkillLevel,
} from "@/lib/types";

function canonicalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function constraintModeForRequestValue(
  rawValue: unknown,
  skillLevel: SkillLevel,
): RequestConstraintMode {
  const value = canonicalize(rawValue);
  if (value === "VAC" || value === "VACATION") return "LOCKED";
  if (value === "ED" || value === "ชED" || value === "อบรม") {
    return skillLevel === "MEMBER_L0" ? "PREFERENCE" : "LOCKED";
  }
  if (["O/D", "D/O", "OFF/D", "D/OFF", "O/N", "N/O", "OFF/N", "N/OFF"].includes(value)) {
    return "REQUIRED";
  }
  return "PREFERENCE";
}

export function constraintModeForNormalizedType(
  normalizedType: ShiftRequest["normalizedType"],
  skillLevel: SkillLevel,
  fallback: RequestConstraintMode = "PREFERENCE",
): RequestConstraintMode {
  if (normalizedType === "VACATION") return "LOCKED";
  if (normalizedType === "EDUCATION") {
    return skillLevel === "MEMBER_L0" ? "PREFERENCE" : "LOCKED";
  }
  if (normalizedType === "OFF_OR_DAY" || normalizedType === "OFF_OR_NIGHT") {
    return "REQUIRED";
  }
  return fallback;
}

export function requestPolicyLabel(mode: RequestConstraintMode) {
  if (mode === "LOCKED") return "Mandatory fixed event";
  if (mode === "REQUIRED") return "Required choice";
  return "Soft request";
}
