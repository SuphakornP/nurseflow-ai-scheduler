import { describe, expect, it } from "vitest";

import {
  MAX_SCHEDULE_NURSES,
  ScheduleDatasetSchema,
} from "@/lib/schedule-schema";

function dataset() {
  return {
    period: {
      id: "period-1",
      code: "MICU-2026-08",
      name: "August roster",
      departmentCode: "MICU",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      contextStartDate: "2026-07-29",
      contextEndDate: "2026-07-31",
      status: "READY" as const,
    },
    nurses: [{ id: "nurse-1", nickname: "Lotus", skillLevel: "INCHARGE" as const }],
    requests: [
      {
        nurseId: "nurse-1",
        date: "2026-08-01",
        rawValue: "O1",
        normalizedType: "OFF_REQUEST" as const,
        priority: 1 as const,
        allowedAssignments: ["OFF" as const],
        constraintMode: "PREFERENCE" as const,
        confidence: 1,
        requiresReview: false,
      },
    ],
    previousAssignments: [
      {
        nurseId: "nurse-1",
        date: "2026-07-31",
        shift: "D" as const,
        source: "LOCKED_REQUEST" as const,
      },
    ],
    sourceLabel: "Test dataset",
    privacyMode: "NICKNAME_ONLY" as const,
  };
}

describe("schedule dataset schema", () => {
  it("accepts a bounded nickname-only schedule", () => {
    expect(ScheduleDatasetSchema.safeParse(dataset()).success).toBe(true);
  });

  it("rejects oversized nurse collections", () => {
    const input = {
      ...dataset(),
      nurses: Array.from({ length: MAX_SCHEDULE_NURSES + 1 }, (_, index) => ({
        id: `nurse-${index}`,
        nickname: `N${index}`,
        skillLevel: "MEMBER_L1" as const,
      })),
    };

    expect(ScheduleDatasetSchema.safeParse(input).success).toBe(false);
  });

  it("rejects cross-period and unknown-nurse work items", () => {
    const input = dataset();
    input.requests[0] = {
      ...input.requests[0],
      nurseId: "unknown",
      date: "2027-01-01",
    };

    expect(ScheduleDatasetSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown request constraint mode", () => {
    const input = {
      ...dataset(),
      requests: [{ ...dataset().requests[0], constraintMode: "REQUIRED" }],
    };

    expect(ScheduleDatasetSchema.safeParse(input).success).toBe(false);
  });
});
