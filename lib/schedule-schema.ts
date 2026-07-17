import { z } from "zod";
import { constraintModeForNormalizedType } from "@/lib/request-semantics";

export const MAX_SCHEDULE_NURSES = 100;
export const MAX_SCHEDULE_DAYS = 62;
export const MAX_SCHEDULE_ITEMS = MAX_SCHEDULE_NURSES * MAX_SCHEDULE_DAYS;

const ShiftCodeSchema = z.enum(["D", "N", "OFF", "VAC", "ED"]);
const SkillLevelSchema = z.enum([
  "INCHARGE",
  "TRAINEE_INC",
  "MEMBER_L1",
  "MEMBER_L2",
  "MEMBER_L0",
]);

const PeriodSchema = z
  .object({
    id: z.string().min(1).max(120),
    code: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    departmentCode: z.string().min(1).max(80),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    contextStartDate: z.iso.date(),
    contextEndDate: z.iso.date(),
    status: z.enum(["DRAFT", "READY", "GENERATED", "CONFIRMED"]),
  })
  .strict();

const NurseSchema = z
  .object({
    id: z.string().min(1).max(64),
    nickname: z.string().min(1).max(80),
    skillLevel: SkillLevelSchema,
    synthetic: z.boolean().optional(),
  })
  .strict();

const ShiftRequestSchema = z
  .object({
    nurseId: z.string().min(1).max(64),
    date: z.iso.date(),
    rawValue: z.string().max(120),
    normalizedType: z.enum([
      "AVAILABLE",
      "OFF_REQUEST",
      "OFF_OR_DAY",
      "OFF_OR_NIGHT",
      "VACATION",
      "EDUCATION",
      "AMBIGUOUS",
    ]),
    priority: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
    allowedAssignments: z.array(ShiftCodeSchema).max(5),
    constraintMode: z.enum(["PREFERENCE", "REQUIRED", "LOCKED"]),
    confidence: z.number().min(0).max(1),
    requiresReview: z.boolean(),
  })
  .strict();

const PreviousAssignmentSchema = z
  .object({
    nurseId: z.string().min(1).max(64),
    date: z.iso.date(),
    shift: ShiftCodeSchema,
    source: z.enum(["SOLVER", "LOCKED_REQUEST", "MANUAL"]),
  })
  .strict();

export const ScheduleDatasetSchema = z
  .object({
    period: PeriodSchema,
    nurses: z.array(NurseSchema).min(1).max(MAX_SCHEDULE_NURSES),
    requests: z.array(ShiftRequestSchema).max(MAX_SCHEDULE_ITEMS),
    previousAssignments: z.array(PreviousAssignmentSchema).max(MAX_SCHEDULE_ITEMS),
    sourceLabel: z.string().min(1).max(200),
    sourceWorkbookHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    privacyMode: z.literal("NICKNAME_ONLY"),
  })
  .strict()
  .superRefine((dataset, context) => {
    const periodDays =
      Math.floor(
        (Date.parse(`${dataset.period.endDate}T00:00:00Z`) -
          Date.parse(`${dataset.period.startDate}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    if (periodDays < 1 || periodDays > MAX_SCHEDULE_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["period", "endDate"],
        message: `The scheduling period must contain 1 to ${MAX_SCHEDULE_DAYS} days.`,
      });
    }

    const nurseIds = new Set<string>();
    const skillByNurseId = new Map<string, z.infer<typeof SkillLevelSchema>>();
    for (const [index, nurse] of dataset.nurses.entries()) {
      if (nurseIds.has(nurse.id)) {
        context.addIssue({
          code: "custom",
          path: ["nurses", index, "id"],
          message: "Nurse ids must be unique.",
        });
      }
      nurseIds.add(nurse.id);
      skillByNurseId.set(nurse.id, nurse.skillLevel);
    }

    const requestKeys = new Set<string>();
    for (const [index, request] of dataset.requests.entries()) {
      if (!nurseIds.has(request.nurseId)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "nurseId"],
          message: "Requests must reference a known nurse.",
        });
      }
      if (request.date < dataset.period.startDate || request.date > dataset.period.endDate) {
        context.addIssue({
          code: "custom",
          path: ["requests", index, "date"],
          message: "Requests must be inside the scheduling period.",
        });
      }
      const skillLevel = skillByNurseId.get(request.nurseId);
      if (skillLevel) {
        const expectedMode = constraintModeForNormalizedType(
          request.normalizedType,
          skillLevel,
        );
        if (request.constraintMode !== expectedMode) {
          context.addIssue({
            code: "custom",
            path: ["requests", index, "constraintMode"],
            message: `${request.normalizedType} must use ${expectedMode} constraint mode.`,
          });
        }
      }
      const key = `${request.nurseId}\0${request.date}`;
      if (requestKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["requests", index],
          message: "A nurse may have only one request per date.",
        });
      }
      requestKeys.add(key);
    }

    const previousKeys = new Set<string>();
    for (const [index, assignment] of dataset.previousAssignments.entries()) {
      if (!nurseIds.has(assignment.nurseId)) {
        context.addIssue({
          code: "custom",
          path: ["previousAssignments", index, "nurseId"],
          message: "Previous assignments must reference a known nurse.",
        });
      }
      if (assignment.date >= dataset.period.startDate) {
        context.addIssue({
          code: "custom",
          path: ["previousAssignments", index, "date"],
          message: "Previous assignments must be before the scheduling period.",
        });
      }
      const key = `${assignment.nurseId}\0${assignment.date}`;
      if (previousKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["previousAssignments", index],
          message: "A nurse may have only one previous assignment per date.",
        });
      }
      previousKeys.add(key);
    }
  });
