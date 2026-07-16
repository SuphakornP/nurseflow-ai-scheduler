import type { ShiftCode, SkillLevel } from "@/lib/types";

export const SHIFT_LABELS: Record<ShiftCode, string> = {
  D: "Day",
  N: "Night",
  OFF: "Off",
  VAC: "Vacation",
  ED: "Education",
};

export const SHIFT_HOURS: Record<ShiftCode, number> = {
  D: 12,
  N: 12,
  OFF: 0,
  VAC: 0,
  ED: 8,
};

export const SKILL_LABELS: Record<SkillLevel, string> = {
  INCHARGE: "Incharge",
  TRAINEE_INC: "Trainee Inc.",
  MEMBER_L1: "Member L1",
  MEMBER_L2: "Member L2",
  MEMBER_L0: "Member L0",
};

export const WORKFLOW_STEPS = [
  { id: "import", label: "Import", hint: "Add requests" },
  { id: "review", label: "Review", hint: "Resolve values" },
  { id: "generate", label: "Generate", hint: "Run optimizer" },
  { id: "compare", label: "Compare", hint: "Choose version" },
  { id: "confirm", label: "Confirm", hint: "Lock & export" },
] as const;
