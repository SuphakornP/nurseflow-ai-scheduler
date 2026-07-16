import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const SkillLevelSchema = z.enum([
  "INCHARGE",
  "TRAINEE_INC",
  "MEMBER_L1",
  "MEMBER_L2",
  "MEMBER_L0",
]);
const ShiftSchema = z.enum(["D", "N", "OFF", "VAC", "ED"]);
const SolverProblemSchema = z.object({
  period_name: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  nurses: z.array(z.object({ id: z.string(), nickname: z.string(), skill_level: SkillLevelSchema })),
  requests: z.array(
    z.object({
      nurse_id: z.string(),
      request_date: z.string(),
      raw_value: z.string(),
      resolution: z
        .object({
          allowed_assignments: z.array(ShiftSchema),
          off_priority: z.number().nullable().optional(),
        })
        .optional(),
    }),
  ),
  previous_assignments: z.array(
    z.object({ nurse_id: z.string(), assignment_date: z.string(), shift: ShiftSchema }),
  ),
  time_limit_seconds: z.number(),
  random_seed: z.number(),
  optimization_profile: z.enum(["balanced", "requests_first", "minimize_l0"]).optional(),
});
const PersistedVersionSchema = z.object({
  id: z.string().uuid(),
  department_id: z.string().uuid(),
  schedule_period_id: z.string().uuid(),
  status: z.literal("CONFIRMED"),
  generation_summary: z.record(z.string(), z.unknown()),
});
const AssignmentRowSchema = z.array(
  z.object({
    period_employee_id: z.string().uuid(),
    shift_type_id: z.string().uuid(),
    assignment_date: z.string(),
  }),
);
const PeriodEmployeeRowSchema = z.array(
  z.object({ id: z.string().uuid(), nickname_snapshot: z.string() }),
);
const ShiftRowSchema = z.array(z.object({ id: z.string().uuid(), code: ShiftSchema }));

export async function loadPersistedVersionForExport(scheduleVersionId: string) {
  const supabase = createAdminClient();
  const { data: versionData, error: versionError } = await supabase
    .from("schedule_versions")
    .select("id, department_id, schedule_period_id, status, generation_summary")
    .eq("id", scheduleVersionId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();
  if (versionError || !versionData) {
    throw new Error(`Persisted schedule version was not found: ${versionError?.message ?? "not found"}`);
  }
  const version = PersistedVersionSchema.parse(versionData);
  const problem = SolverProblemSchema.parse(version.generation_summary.solver_problem);

  const [assignmentsResult, employeesResult, shiftsResult] = await Promise.all([
    supabase
      .from("schedule_assignments")
      .select("period_employee_id, shift_type_id, assignment_date")
      .eq("schedule_version_id", version.id)
      .eq("schedule_period_id", version.schedule_period_id)
      .eq("department_id", version.department_id)
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("schedule_period_employees")
      .select("id, nickname_snapshot")
      .eq("schedule_period_id", version.schedule_period_id)
      .eq("department_id", version.department_id)
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("shift_types")
      .select("id, code")
      .eq("department_id", version.department_id)
      .eq("is_active", true)
      .is("deleted_at", null),
  ]);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);

  const assignmentRows = AssignmentRowSchema.parse(assignmentsResult.data);
  const employeeRows = PeriodEmployeeRowSchema.parse(employeesResult.data);
  const shiftRows = ShiftRowSchema.parse(shiftsResult.data);
  const nicknameByPeriodEmployee = new Map(
    employeeRows.map((employee) => [employee.id, employee.nickname_snapshot]),
  );
  const nurseByNickname = new Map(
    problem.nurses.map((nurse) => [nurse.nickname.trim().toLocaleLowerCase("en"), nurse]),
  );
  const shiftById = new Map(shiftRows.map((shift) => [shift.id, shift.code]));

  const assignments = assignmentRows.map((row) => {
    const nickname = nicknameByPeriodEmployee.get(row.period_employee_id);
    const nurse = nickname
      ? nurseByNickname.get(nickname.trim().toLocaleLowerCase("en"))
      : undefined;
    const shift = shiftById.get(row.shift_type_id);
    if (!nurse || !shift) {
      throw new Error("Persisted assignment references an unknown nickname or shift.");
    }
    return {
      nurse_id: nurse.id,
      nickname: nurse.nickname,
      skill_level: nurse.skill_level,
      assignment_date: row.assignment_date,
      shift,
    };
  });

  return { problem, assignments };
}
