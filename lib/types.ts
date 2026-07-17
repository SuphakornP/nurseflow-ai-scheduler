export const SHIFT_CODES = ["D", "N", "OFF", "VAC", "ED"] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];

export const REQUEST_CONSTRAINT_MODES = ["PREFERENCE", "REQUIRED", "LOCKED"] as const;
export type RequestConstraintMode = (typeof REQUEST_CONSTRAINT_MODES)[number];

export const SKILL_LEVELS = [
  "INCHARGE",
  "TRAINEE_INC",
  "MEMBER_L1",
  "MEMBER_L2",
  "MEMBER_L0",
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export type WorkflowStep =
  | "import"
  | "review"
  | "generate"
  | "compare"
  | "confirm";

export interface Nurse {
  id: string;
  nickname: string;
  skillLevel: SkillLevel;
  synthetic?: boolean;
}

export interface ShiftRequest {
  nurseId: string;
  date: string;
  rawValue: string;
  normalizedType:
    | "AVAILABLE"
    | "OFF_REQUEST"
    | "OFF_OR_DAY"
    | "OFF_OR_NIGHT"
    | "VACATION"
    | "EDUCATION"
    | "AMBIGUOUS";
  priority?: 1 | 2 | 3 | 4;
  allowedAssignments: ShiftCode[];
  /** Soft wishes, required choice sets, and immutable approved events stay explicit. */
  constraintMode: RequestConstraintMode;
  confidence: number;
  requiresReview: boolean;
}

export interface Assignment {
  nurseId: string;
  date: string;
  shift: ShiftCode;
  source: "SOLVER" | "LOCKED_REQUEST" | "MANUAL";
}

export interface ConstraintResult {
  code: string;
  name: string;
  type: "HARD" | "SOFT";
  status: "PASS" | "FAIL" | "WARNING";
  violationCount: number;
  details: string[];
}

export interface VersionMetrics {
  /** Satisfaction among PREFERENCE entries only. */
  requestSatisfactionRate: number;
  offSatisfactionRate: number;
  o1SatisfactionRate: number;
  dayBalanceScore: number;
  nightBalanceScore: number;
  weekendBalanceScore: number;
  memberL0Usage: number;
  hardConstraintsPassed: number;
  hardConstraintsTotal: number;
  lockedRequirementsPassed: number;
  lockedRequirementsTotal: number;
  requiredChoicesPassed: number;
  requiredChoicesTotal: number;
}

export interface RequestOutcome {
  nurseId: string;
  date: string;
  requested: string;
  normalizedType: ShiftRequest["normalizedType"];
  constraintMode: RequestConstraintMode;
  assigned: ShiftCode;
  priority?: number;
  satisfied: boolean;
  reasonCode?: string;
  explanation?: string;
}

export interface ScheduleVersion {
  id: string;
  versionNo: number;
  name: string;
  status: "CANDIDATE" | "VALID" | "INVALID" | "CONFIRMED";
  solverStatus: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "DEMO";
  generatedAt: string;
  confirmedAt?: string;
  confirmedByNickname?: string;
  objectiveScore?: number;
  assignments: Assignment[];
  validations: ConstraintResult[];
  metrics: VersionMetrics;
  requestOutcomes: RequestOutcome[];
}

export interface SchedulePeriod {
  id: string;
  code: string;
  name: string;
  departmentCode: string;
  startDate: string;
  endDate: string;
  contextStartDate: string;
  contextEndDate: string;
  status: "DRAFT" | "READY" | "GENERATED" | "CONFIRMED";
}

export interface ScheduleDataset {
  period: SchedulePeriod;
  nurses: Nurse[];
  requests: ShiftRequest[];
  previousAssignments: Assignment[];
  sourceLabel: string;
  /** Server-generated digest binding a generated version to its sanitized source template. */
  sourceWorkbookHash?: string;
  privacyMode: "NICKNAME_ONLY";
}

export interface GenerateScheduleResponse {
  dataset: ScheduleDataset;
  versions: ScheduleVersion[];
  mode: "solver" | "demo";
  message?: string;
}
