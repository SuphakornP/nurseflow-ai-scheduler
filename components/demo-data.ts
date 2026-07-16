import type {
  Assignment,
  ConstraintResult,
  GenerateScheduleResponse,
  Nurse,
  RequestOutcome,
  ScheduleVersion,
  ShiftCode,
  ShiftRequest,
  SkillLevel,
  VersionMetrics,
} from "@/lib/types";
import { getDates } from "@/lib/utils";

const NICKNAMES_BY_SKILL: Record<SkillLevel, string[]> = {
  INCHARGE: ["Mali", "Ploy", "Fern", "Nicha", "Mint", "Kwan", "Bow", "Fai"],
  TRAINEE_INC: ["Noon", "Ing", "Aom", "Jan"],
  MEMBER_L1: [
    "Pim",
    "Pear",
    "Mew",
    "Fon",
    "Gift",
    "Aim",
    "Nan",
    "Som",
    "Yok",
    "Bam",
    "View",
  ],
  MEMBER_L2: ["Cream", "Praew", "Belle", "Joy"],
  MEMBER_L0: ["Sky"],
};

const VALIDATION_NAMES = [
  ["DAILY_DAY_STAFFING", "Day staffing: 10 RN"],
  ["DAILY_NIGHT_STAFFING", "Night staffing: 9 RN"],
  ["SKILL_MIX", "Skill mix by level"],
  ["MAX_CONSECUTIVE_DAY", "Maximum 3 Day shifts"],
  ["MAX_CONSECUTIVE_NIGHT", "Maximum 3 Night shifts"],
  ["MAX_CONSECUTIVE_WORK", "Maximum 5 working days"],
  ["NIGHT_TO_DAY", "No Night to Day transition"],
  ["NIGHT_TO_EDUCATION", "No Night to Education transition"],
  ["VACATION_LOCK", "Vacation preserved"],
  ["MEMBER_L0_LIMIT", "Member L0 at most 7 shifts"],
] as const;

interface RequestSpec {
  nurseId: string;
  date: string;
  requested: "O1" | "O2" | "O3";
  priority: 1 | 2 | 3;
}

function makeNurses(): Nurse[] {
  return Object.entries(NICKNAMES_BY_SKILL).flatMap(([skillLevel, nicknames]) =>
    nicknames.map((nickname, index) => ({
      id: `${skillLevel.toLowerCase()}-${index + 1}`,
      nickname,
      skillLevel: skillLevel as SkillLevel,
      synthetic: true,
    })),
  );
}

function takeRotating<T>(items: T[], start: number, count: number) {
  return Array.from({ length: count }, (_, index) => items[(start + index) % items.length]);
}

function makeAssignments(nurses: Nurse[]): Assignment[] {
  const dates = getDates("2026-08-01", "2026-08-31");
  const groups = Object.fromEntries(
    Object.keys(NICKNAMES_BY_SKILL).map((skill) => [
      skill,
      nurses.filter((nurse) => nurse.skillLevel === skill),
    ]),
  ) as Record<SkillLevel, Nurse[]>;

  const mix: Record<SkillLevel, { day: number; night: number }> = {
    INCHARGE: { day: 3, night: 3 },
    TRAINEE_INC: { day: 2, night: 1 },
    MEMBER_L1: { day: 4, night: 4 },
    MEMBER_L2: { day: 1, night: 1 },
    MEMBER_L0: { day: 0, night: 0 },
  };

  return dates.flatMap((date, dateIndex) => {
    const shifts = new Map(nurses.map((nurse) => [nurse.id, "OFF" as ShiftCode]));

    (Object.keys(mix) as SkillLevel[]).forEach((skillLevel, skillIndex) => {
      const group = groups[skillLevel];
      if (!group.length) return;
      const { day, night } = mix[skillLevel];
      const start = (dateIndex * 2 + skillIndex) % group.length;
      takeRotating(group, start, day).forEach((nurse) => shifts.set(nurse.id, "D"));
      takeRotating(group, start + day, night).forEach((nurse) => shifts.set(nurse.id, "N"));
    });

    return nurses.map((nurse) => ({
      nurseId: nurse.id,
      date,
      shift: shifts.get(nurse.id) ?? "OFF",
      source: "SOLVER" as const,
    }));
  });
}

function replaceFirstOff(
  assignments: Assignment[],
  date: string,
  shift: "VAC" | "ED",
  ignoredNurseIds: Set<string>,
) {
  const assignment = assignments.find(
    (item) => item.date === date && item.shift === "OFF" && !ignoredNurseIds.has(item.nurseId),
  );
  if (!assignment) throw new Error(`Unable to create locked ${shift} demo assignment.`);
  assignment.shift = shift;
  assignment.source = "LOCKED_REQUEST";
  ignoredNurseIds.add(assignment.nurseId);
  return assignment.nurseId;
}

function swapWithinSkill(
  assignments: Assignment[],
  nurses: Nurse[],
  date: string,
  skillLevel: SkillLevel,
  firstShift: ShiftCode,
  secondShift: ShiftCode,
) {
  const nurseIds = new Set(
    nurses.filter((nurse) => nurse.skillLevel === skillLevel).map((nurse) => nurse.id),
  );
  const first = assignments.find(
    (item) => item.date === date && item.shift === firstShift && nurseIds.has(item.nurseId),
  );
  const second = assignments.find(
    (item) => item.date === date && item.shift === secondShift && nurseIds.has(item.nurseId),
  );
  if (!first || !second) return;
  [first.shift, second.shift] = [second.shift, first.shift];
}

function makeValidations(): ConstraintResult[] {
  return VALIDATION_NAMES.map(([code, name]) => ({
    code,
    name,
    type: "HARD",
    status: "PASS",
    violationCount: 0,
    details: [],
  }));
}

function makeMetrics(
  offSatisfactionRate: number,
  dayBalanceScore: number,
  nightBalanceScore: number,
  memberL0Usage: number,
): VersionMetrics {
  return {
    offSatisfactionRate,
    o1SatisfactionRate: 100,
    dayBalanceScore,
    nightBalanceScore,
    weekendBalanceScore: 91.4,
    memberL0Usage,
    hardConstraintsPassed: VALIDATION_NAMES.length,
    hardConstraintsTotal: VALIDATION_NAMES.length,
  };
}

function makeOutcomes(assignments: Assignment[], requestSpecs: RequestSpec[]): RequestOutcome[] {
  return requestSpecs.map((request) => {
    const assigned =
      assignments.find(
        (item) => item.nurseId === request.nurseId && item.date === request.date,
      )?.shift ?? "OFF";
    const satisfied = assigned === "OFF";
    const assignedLabel = assigned === "N" ? "Night" : assigned === "D" ? "Day" : assigned;
    return {
      nurseId: request.nurseId,
      date: request.date,
      requested: request.requested,
      assigned,
      priority: request.priority,
      satisfied,
      reasonCode: satisfied ? undefined : "SKILL_MIX_COVERAGE",
      explanation: satisfied
        ? `${request.requested} was preserved without reducing coverage.`
        : `${request.requested} could not be preserved because ${assignedLabel} coverage would fall below the required skill mix. Lower-priority flexibility was used before this request was changed.`,
    };
  });
}

function makeRequest(
  spec: RequestSpec,
  assigned: ShiftCode,
): ShiftRequest {
  return {
    nurseId: spec.nurseId,
    date: spec.date,
    rawValue: spec.requested,
    normalizedType: "OFF_REQUEST",
    priority: spec.priority,
    allowedAssignments: ["OFF"],
    confidence: 1,
    requiresReview: false,
    ...(assigned === "VAC" ? { normalizedType: "VACATION" as const } : {}),
  };
}

function makePreviousAssignments(nurses: Nurse[]): Assignment[] {
  const dates = ["2026-07-29", "2026-07-30", "2026-07-31"];
  return dates.flatMap((date, dateIndex) =>
    nurses.map((nurse, nurseIndex) => ({
      nurseId: nurse.id,
      date,
      shift: (["OFF", "D", "N"] as ShiftCode[])[(nurseIndex + dateIndex) % 3],
      source: "LOCKED_REQUEST" as const,
    })),
  );
}

export function createDemoResponse(): GenerateScheduleResponse {
  const nurses = makeNurses();
  const baselineAssignments = makeAssignments(nurses);
  const lockedNurseIds = new Set<string>();
  const vacationOne = replaceFirstOff(
    baselineAssignments,
    "2026-08-09",
    "VAC",
    lockedNurseIds,
  );
  const vacationTwo = replaceFirstOff(
    baselineAssignments,
    "2026-08-20",
    "VAC",
    lockedNurseIds,
  );
  const education = replaceFirstOff(
    baselineAssignments,
    "2026-08-25",
    "ED",
    lockedNurseIds,
  );

  const requestSpecs: RequestSpec[] = [
    {
      nurseId:
        baselineAssignments.find(
          (item) => item.date === "2026-08-06" && item.shift === "OFF",
        )?.nurseId ?? nurses[0].id,
      date: "2026-08-06",
      requested: "O1",
      priority: 1,
    },
    {
      nurseId:
        baselineAssignments.find(
          (item) => item.date === "2026-08-14" && item.shift === "N",
        )?.nurseId ?? nurses[1].id,
      date: "2026-08-14",
      requested: "O2",
      priority: 2,
    },
    {
      nurseId:
        baselineAssignments.find(
          (item) => item.date === "2026-08-21" && item.shift === "D",
        )?.nurseId ?? nurses[2].id,
      date: "2026-08-21",
      requested: "O3",
      priority: 3,
    },
  ];

  const versionTwoAssignments = baselineAssignments.map((item) => ({ ...item }));
  swapWithinSkill(
    versionTwoAssignments,
    nurses,
    "2026-08-14",
    "MEMBER_L1",
    "D",
    "OFF",
  );
  swapWithinSkill(
    versionTwoAssignments,
    nurses,
    "2026-08-21",
    "INCHARGE",
    "N",
    "OFF",
  );
  swapWithinSkill(
    versionTwoAssignments,
    nurses,
    "2026-08-27",
    "MEMBER_L2",
    "D",
    "OFF",
  );

  const versionThreeAssignments = versionTwoAssignments.map((item) => ({ ...item }));
  swapWithinSkill(
    versionThreeAssignments,
    nurses,
    "2026-08-11",
    "TRAINEE_INC",
    "D",
    "OFF",
  );
  swapWithinSkill(
    versionThreeAssignments,
    nurses,
    "2026-08-18",
    "MEMBER_L1",
    "N",
    "OFF",
  );

  const validations = makeValidations();
  const versionDefinitions: Array<{
    id: string;
    versionNo: number;
    name: string;
    assignments: Assignment[];
    metrics: VersionMetrics;
    score: number;
  }> = [
    {
      id: "demo-version-1",
      versionNo: 1,
      name: "Coverage first",
      assignments: baselineAssignments,
      metrics: makeMetrics(84.6, 89.2, 88.7, 3),
      score: 18240,
    },
    {
      id: "demo-version-2",
      versionNo: 2,
      name: "Balanced requests",
      assignments: versionTwoAssignments,
      metrics: makeMetrics(88.2, 92.6, 91.8, 2),
      score: 14510,
    },
    {
      id: "demo-version-3",
      versionNo: 3,
      name: "Minimum L0",
      assignments: versionThreeAssignments,
      metrics: makeMetrics(86.8, 94.1, 93.4, 0),
      score: 15180,
    },
  ];

  const versions: ScheduleVersion[] = versionDefinitions.map((definition) => ({
    id: definition.id,
    versionNo: definition.versionNo,
    name: definition.name,
    status: "VALID",
    solverStatus: "DEMO",
    generatedAt: "2026-07-16T10:24:00+07:00",
    objectiveScore: definition.score,
    assignments: definition.assignments,
    validations,
    metrics: definition.metrics,
    requestOutcomes: makeOutcomes(definition.assignments, requestSpecs),
  }));

  const requestRows: ShiftRequest[] = [
    ...requestSpecs.map((spec) => makeRequest(spec, "OFF")),
    {
      nurseId: vacationOne,
      date: "2026-08-09",
      rawValue: "Vac",
      normalizedType: "VACATION",
      allowedAssignments: ["VAC"],
      confidence: 1,
      requiresReview: false,
    },
    {
      nurseId: vacationTwo,
      date: "2026-08-20",
      rawValue: "VAC",
      normalizedType: "VACATION",
      allowedAssignments: ["VAC"],
      confidence: 1,
      requiresReview: false,
    },
    {
      nurseId: education,
      date: "2026-08-25",
      rawValue: "ED",
      normalizedType: "EDUCATION",
      allowedAssignments: ["ED"],
      confidence: 1,
      requiresReview: false,
    },
    {
      nurseId: nurses[9].id,
      date: "2026-08-18",
      rawValue: "O1/N",
      normalizedType: "AMBIGUOUS",
      priority: 1,
      allowedAssignments: ["OFF", "N"],
      confidence: 0.68,
      requiresReview: true,
    },
    {
      nurseId: nurses[14].id,
      date: "2026-08-23",
      rawValue: "D/N",
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D", "N"],
      confidence: 0.61,
      requiresReview: true,
    },
    {
      nurseId: nurses[20].id,
      date: "2026-08-26",
      rawValue: "Vac1",
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["VAC"],
      confidence: 0.54,
      requiresReview: true,
    },
    {
      nurseId: nurses[24].id,
      date: "2026-08-29",
      rawValue: "D1",
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D"],
      confidence: 0.49,
      requiresReview: true,
    },
  ];

  return {
    dataset: {
      period: {
        id: "demo-period-2026-08",
        code: "MICU-2026-08",
        name: "MICU - August 2026",
        departmentCode: "MICU",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        contextStartDate: "2026-07-29",
        contextEndDate: "2026-07-31",
        status: "GENERATED",
      },
      nurses,
      requests: requestRows,
      previousAssignments: makePreviousAssignments(nurses),
      sourceLabel: "Synthetic MICU showcase dataset",
      privacyMode: "NICKNAME_ONLY",
    },
    versions,
    mode: "demo",
    message: "Synthetic nickname-only data is active. No personal data is stored.",
  };
}
