import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  prepareSourceWorkbookTemplate,
  sourceWorkbookTemplateToSolverPayload,
} from "@/lib/source-workbook-template";
import type { ScheduleDataset } from "@/lib/types";

const dataset: ScheduleDataset = {
  period: {
    id: "period-template-test",
    code: "MICU-2026-08",
    name: "August 2026 Roster",
    departmentCode: "MICU",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    contextStartDate: "2026-07-29",
    contextEndDate: "2026-07-31",
    status: "READY",
  },
  nurses: [
    { id: "nurse-a", nickname: "Alpha", skillLevel: "INCHARGE" },
    { id: "nurse-b", nickname: "Beta", skillLevel: "MEMBER_L1" },
  ],
  requests: [],
  previousAssignments: [],
  sourceLabel: "synthetic-template.xlsx",
  privacyMode: "NICKNAME_ONLY",
};

async function sourceWorkbookBytes() {
  const workbook = new ExcelJS.Workbook();
  workbook.title = "Confidential scheduling workbook";
  const sheet = workbook.addWorksheet("Request Form");
  sheet.getCell("A1").value = "MICU request template";
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.getCell("B1").value = { formula: "=1+1", result: 2 };
  sheet.getCell("C1").value = { text: "External portal", hyperlink: "https://example.invalid" };
  sheet.addRow([
    "รหัสพนักงาน",
    "ชื่อ - สกุล",
    "Level",
    29,
    30,
    31,
    ...Array.from({ length: 31 }, (_, index) => index + 1),
    "หมายเหตุ",
  ]);
  sheet.addRow(["EMP-001", "Alpha", "Incharge", "D", "N", "O", ...Array(31).fill(""), "remove-a"]);
  sheet.addRow(["EMP-002", "Beta", "Member L.1", "N", "O", "D", ...Array(31).fill(""), "remove-b"]);
  sheet.getCell("AM3").value = "HIDDEN-CODE-777";
  sheet.getColumn("AM").hidden = true;
  workbook.addWorksheet("Unrelated Hidden Data").addRow(["must-not-survive"]);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("source workbook template", () => {
  it("preserves the first-sheet layout while removing codes, notes, and unrelated sheets", async () => {
    const template = await prepareSourceWorkbookTemplate(await sourceWorkbookBytes(), dataset);

    expect(template.worksheetName).toBe("Request Form");
    expect(template.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(template.nurseRows).toEqual({ "nurse-a": 3, "nurse-b": 4 });
    expect(template.dateColumns["2026-08-01"]).toBe(7);
    expect(template.dateColumns["2026-08-14"]).toBe(20);
    expect(template.dateColumns["2026-08-31"]).toBe(37);

    const sanitized = new ExcelJS.Workbook();
    await sanitized.xlsx.load(
      template.bytes as unknown as Parameters<typeof sanitized.xlsx.load>[0],
    );
    expect(sanitized.worksheets.map((sheet) => sheet.name)).toEqual(["Request Form"]);
    const sheet = sanitized.worksheets[0];
    expect(sheet.getCell("A3").value).toBeNull();
    expect(sheet.getCell("A4").value).toBeNull();
    expect(sheet.getCell("B3").value).toBe("Alpha");
    expect(sheet.getCell("B1").value).toBe(2);
    expect(sheet.getCell("C1").value).toBe("External portal");
    expect(sheet.getCell("C1").hyperlink).toBeUndefined();
    expect(sheet.getCell("AL3").value).toBeNull();
    expect(sheet.getCell("AM3").value).toBeNull();
    expect(sanitized.title).toBeFalsy();
    expect(sheet.getCell("A1").fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F766E" },
    });

    const payload = sourceWorkbookTemplateToSolverPayload(template);
    expect(Buffer.from(payload.content_base64, "base64")).toEqual(Buffer.from(template.bytes));
  });
});
