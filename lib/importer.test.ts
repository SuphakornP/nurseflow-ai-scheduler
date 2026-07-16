import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { googleSheetExportUrl, parseWorkbook } from "@/lib/importer";
import type { SchedulePeriod } from "@/lib/types";
import { getDates } from "@/lib/utils";

const period: SchedulePeriod = {
  id: "import-test-period",
  code: "MICU-2026-08",
  name: "August 2026",
  departmentCode: "MICU",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  contextStartDate: "2026-07-29",
  contextEndDate: "2026-07-31",
  status: "DRAFT",
};

async function workbookBytes(includeIdentityColumn = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Requests");
  const dates = [
    ...getDates(period.contextStartDate, period.contextEndDate),
    ...getDates(period.startDate, period.endDate),
  ];
  const identityHeaders = includeIdentityColumn ? ["full name"] : [];
  sheet.addRow(["nickname", "skill_level", ...identityHeaders, ...dates]);
  sheet.addRow([
    "Mint",
    "INCHARGE",
    ...(includeIdentityColumn ? ["prohibited"] : []),
    "OFF",
    "D",
    "D",
    "O1",
    ...Array(dates.length - 4).fill(""),
  ]);
  sheet.addRow([
    "Beam",
    "TRAINEE_INC",
    ...(includeIdentityColumn ? ["prohibited"] : []),
    "OFF",
    "N",
    "N",
    ...Array(dates.length - 3).fill(""),
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("parseWorkbook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses nickname-only context and monthly requests", async () => {
    const dataset = await parseWorkbook(await workbookBytes(), period, "test.xlsx");
    expect(dataset.privacyMode).toBe("NICKNAME_ONLY");
    expect(dataset.nurses).toHaveLength(2);
    expect(dataset.nurses[0]).toMatchObject({ nickname: "Mint", skillLevel: "INCHARGE" });
    expect(dataset.nurses[1]).toMatchObject({ nickname: "Beam", skillLevel: "TRAINEE_INC" });
    expect(dataset.previousAssignments).toHaveLength(6);
    expect(dataset.requests).toHaveLength(62);
    expect(dataset.requests[0]).toMatchObject({ rawValue: "O1", priority: 1 });
  });

  it("rejects worksheets containing legal-name columns", async () => {
    await expect(
      parseWorkbook(await workbookBytes(true), period, "unsafe.xlsx"),
    ).rejects.toThrow("nickname or pseudonym only");
  });
});

describe("googleSheetExportUrl", () => {
  it("accepts only canonical HTTPS Google Sheet URLs", () => {
    expect(
      googleSheetExportUrl(
        "https://docs.google.com/spreadsheets/d/abc-123/edit?gid=42",
      ),
    ).toBe(
      "https://docs.google.com/spreadsheets/d/abc-123/export?format=xlsx&gid=42",
    );
    expect(() => googleSheetExportUrl("https://example.com/sheet.xlsx")).toThrow(
      "docs.google.com",
    );
  });
});
