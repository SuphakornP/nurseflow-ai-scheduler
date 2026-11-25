import type { SchedulePeriod } from "@/lib/types";

export const MAX_CONTEXT_DAYS = 62;

export function createWorkbookPeriod(month: string, contextDays: number, id: string): SchedulePeriod {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Choose the scheduling month shown in the workbook.");
  }
  if (!Number.isInteger(contextDays) || contextDays < 1 || contextDays > MAX_CONTEXT_DAYS) {
    throw new Error(`Enter between 1 and ${MAX_CONTEXT_DAYS} previous days of shift context.`);
  }

  const startDate = `${month}-01`;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const previousDate = (daysBefore: number) => {
    const date = new Date(start);
    date.setUTCDate(1 - daysBefore);
    return date.toISOString().slice(0, 10);
  };

  return {
    id,
    code: `MICU-${month}`,
    name: `${start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} roster`,
    departmentCode: "MICU",
    startDate,
    endDate: end.toISOString().slice(0, 10),
    contextStartDate: previousDate(contextDays),
    contextEndDate: previousDate(1),
    status: "DRAFT",
  };
}
