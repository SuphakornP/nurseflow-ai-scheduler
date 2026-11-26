import { describe, expect, it } from "vitest";
import { createWorkbookPeriod } from "@/lib/workbook-period";

describe("workbook scheduling period", () => {
  it("calculates the selected month and the preceding context across a year boundary", () => {
    expect(createWorkbookPeriod("2027-01", 5, "upload-1")).toEqual({
      id: "upload-1",
      code: "MICU-2027-01",
      name: "January 2027 roster",
      departmentCode: "MICU",
      startDate: "2027-01-01",
      endDate: "2027-01-31",
      contextStartDate: "2026-12-27",
      contextEndDate: "2026-12-31",
      status: "DRAFT",
    });
  });

  it("includes leap day and supports a single day of context", () => {
    expect(createWorkbookPeriod("2028-02", 1, "upload-2")).toMatchObject({
      endDate: "2028-02-29",
      contextStartDate: "2028-01-31",
      contextEndDate: "2028-01-31",
    });
  });

  it.each(["", "2026-00", "2026-13"])("rejects invalid month %s", (value) => {
    expect(() => createWorkbookPeriod(value, 3, "upload")).toThrow("scheduling month");
  });

  it.each([0, 63, 1.5, NaN])("rejects invalid context length %s", (value) => {
    expect(() => createWorkbookPeriod("2027-01", value, "upload")).toThrow("previous days");
  });
});
