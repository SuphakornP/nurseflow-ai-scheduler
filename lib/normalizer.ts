import type {
  RequestConstraintMode,
  ShiftCode,
  ShiftRequest,
} from "@/lib/types";

const SHIFT_ALIASES: Record<string, ShiftCode> = {
  D: "D",
  DAY: "D",
  N: "N",
  NIGHT: "N",
  O: "OFF",
  OFF: "OFF",
  VAC: "VAC",
  VACATION: "VAC",
  ED: "ED",
  "ชED": "ED",
};

function clean(rawValue: unknown) {
  return String(rawValue ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeRequestValue(
  rawValue: unknown,
  nurseId: string,
  date: string,
  constraintMode: RequestConstraintMode = "LOCKED",
): ShiftRequest {
  const cleaned = clean(rawValue);
  const base = {
    nurseId,
    date,
    rawValue: String(rawValue ?? "").trim(),
    constraintMode,
  };

  if (!cleaned) {
    return {
      ...base,
      normalizedType: "AVAILABLE",
      allowedAssignments: ["D", "N", "OFF"],
      confidence: 1,
      requiresReview: false,
    };
  }

  if (/^O[1-4]$/.test(cleaned)) {
    const priority = Number(cleaned.slice(1)) as 1 | 2 | 3 | 4;
    return {
      ...base,
      normalizedType: "OFF_REQUEST",
      priority,
      allowedAssignments: ["OFF"],
      confidence: 1,
      requiresReview: false,
    };
  }

  if (["O/D", "D/O", "OFF/D", "D/OFF"].includes(cleaned)) {
    return {
      ...base,
      normalizedType: "OFF_OR_DAY",
      allowedAssignments: ["OFF", "D"],
      confidence: 1,
      requiresReview: false,
    };
  }

  if (["O/N", "N/O", "OFF/N", "N/OFF"].includes(cleaned)) {
    return {
      ...base,
      normalizedType: "OFF_OR_NIGHT",
      allowedAssignments: ["OFF", "N"],
      confidence: 1,
      requiresReview: false,
    };
  }

  const direct = SHIFT_ALIASES[cleaned];
  if (direct === "VAC") {
    return {
      ...base,
      normalizedType: "VACATION",
      allowedAssignments: ["VAC"],
      confidence: 1,
      requiresReview: false,
    };
  }
  if (direct === "ED") {
    return {
      ...base,
      normalizedType: "EDUCATION",
      allowedAssignments: ["ED"],
      confidence: 1,
      requiresReview: false,
    };
  }
  if (direct === "OFF") {
    return {
      ...base,
      normalizedType: "OFF_REQUEST",
      priority: 4,
      allowedAssignments: ["OFF"],
      confidence: 0.9,
      requiresReview: false,
    };
  }
  if (direct === "D" || direct === "N") {
    return {
      ...base,
      normalizedType: "AMBIGUOUS",
      allowedAssignments: [direct],
      confidence: 0.8,
      requiresReview: true,
    };
  }

  const flexiblePriority = cleaned.match(/^O([1-4])\/N$/);
  if (flexiblePriority) {
    return {
      ...base,
      normalizedType: "AMBIGUOUS",
      priority: Number(flexiblePriority[1]) as 1 | 2 | 3 | 4,
      allowedAssignments: ["OFF", "N"],
      confidence: 0.6,
      requiresReview: true,
    };
  }

  return {
    ...base,
    normalizedType: "AMBIGUOUS",
    allowedAssignments: ["D", "N", "OFF"],
    confidence: 0,
    requiresReview: true,
  };
}
