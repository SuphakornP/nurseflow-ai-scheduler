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

const LIVE_SHEET_STAFF = [
  ...Array.from({ length: 8 }, (_, index) => ({
    employeeCode: 900001 + index,
    nickname: `IC${index + 1}`,
    level: "Incharge",
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    employeeCode: 900101 + index,
    nickname: `TR${index + 1}`,
    level: "Trainee Inc.",
  })),
  ...Array.from({ length: 11 }, (_, index) => ({
    employeeCode: 900201 + index,
    nickname: `L1${index + 1}`,
    level: "Member L.1",
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    employeeCode: 900301 + index,
    nickname: `L2${index + 1}`,
    level: "Member L.2",
  })),
  { employeeCode: 900401, nickname: "L0A", level: "Member L.0" },
];

async function liveGoogleSheetBytes(
  employeeCodes: readonly (string | number)[] = LIVE_SHEET_STAFF.map(
    (staff) => staff.employeeCode,
  ),
  nicknames: readonly string[] = LIVE_SHEET_STAFF.map((staff) => staff.nickname),
  levels: readonly string[] = LIVE_SHEET_STAFF.map((staff) => staff.level),
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ชีต 1");
  const contextDays = [29, 30, 31];
  const augustDays = Array.from({ length: 31 }, (_, index) => index + 1);
  const weekdayLabels = [
    "พ",
    "พฤ",
    "ศ",
    "ส",
    "อา",
    "จ",
    "อ",
    "พ",
    "พฤ",
    "ศ",
    "ส",
    "อา",
    "จ",
    "อ",
    "พ",
    "พฤ",
    "ศ",
    "ส",
    "อา",
    "จ",
    "อ",
    "พ",
    "พฤ",
    "ศ",
    "ส",
    "อา",
    "จ",
    "อ",
    "พ",
    "พฤ",
    "ศ",
    "ส",
    "อา",
    "จ",
  ];

  sheet.addRow(["ตารางขอเวร MICU สิงหาคม 2569"]);
  sheet.mergeCells("A1:AL1");
  sheet.addRow(["", "", "", ...weekdayLabels, "หมายเหตุ"]);
  sheet.addRow([
    "รหัสพนักงาน",
    "ชื่อ - สกุล",
    "Level",
    ...contextDays,
    ...augustDays,
    "",
  ]);

  LIVE_SHEET_STAFF.forEach((staff, index) => {
    const monthlyRequests = Array(31).fill("");
    if (index === 0) {
      monthlyRequests.splice(0, 4, "D/N", "D1", "O1/N", "VAC1");
    }
    if (index === 1) monthlyRequests[13] = "VAC";
    if (index === 8) monthlyRequests[14] = "ED";
    if (index === 12) monthlyRequests[15] = "O/D";
    if (index === 23) monthlyRequests[16] = "O/N";
    if (index === LIVE_SHEET_STAFF.length - 1) monthlyRequests[17] = "ED";
    sheet.addRow([
      employeeCodes[index] ?? "",
      nicknames[index] ?? staff.nickname,
      levels[index] ?? staff.level,
      "D",
      "N",
      "O",
      ...monthlyRequests,
      `private-note-${index + 1}`,
    ]);
  });

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
    expect(dataset.requests.every((request) => request.constraintMode === "PREFERENCE")).toBe(
      true,
    );
  });

  it("rejects worksheets containing legal-name columns", async () => {
    await expect(
      parseWorkbook(await workbookBytes(true), period, "unsafe.xlsx"),
    ).rejects.toThrow("nickname or pseudonym only");
  });

  it("parses the live Google Sheet layout without returning employee codes or notes", async () => {
    const dataset = await parseWorkbook(
      await liveGoogleSheetBytes(),
      period,
      "Google Sheet: ขอเวรสิงหา",
    );

    expect(dataset.privacyMode).toBe("NICKNAME_ONLY");
    expect(dataset.nurses).toHaveLength(28);
    expect(
      Object.fromEntries(
        ["INCHARGE", "TRAINEE_INC", "MEMBER_L1", "MEMBER_L2", "MEMBER_L0"].map(
          (skillLevel) => [
            skillLevel,
            dataset.nurses.filter((nurse) => nurse.skillLevel === skillLevel).length,
          ],
        ),
      ),
    ).toEqual({ INCHARGE: 8, TRAINEE_INC: 4, MEMBER_L1: 11, MEMBER_L2: 4, MEMBER_L0: 1 });
    expect(dataset.previousAssignments).toHaveLength(84);
    expect(dataset.previousAssignments.slice(0, 3)).toMatchObject([
      { date: "2026-07-29", shift: "D" },
      { date: "2026-07-30", shift: "N" },
      { date: "2026-07-31", shift: "OFF" },
    ]);
    expect(dataset.requests).toHaveLength(868);
    const nurseById = new Map(dataset.nurses.map((nurse) => [nurse.id, nurse]));
    const vacation = dataset.requests.find((request) => request.rawValue === "VAC");
    const education = dataset.requests.filter((request) => request.rawValue === "ED");
    expect(vacation).toMatchObject({ normalizedType: "VACATION", constraintMode: "LOCKED" });
    expect(education).toHaveLength(2);
    expect(
      education.map((request) => ({
        skillLevel: nurseById.get(request.nurseId)?.skillLevel,
        mode: request.constraintMode,
      })),
    ).toEqual([
      { skillLevel: "TRAINEE_INC", mode: "LOCKED" },
      { skillLevel: "MEMBER_L0", mode: "PREFERENCE" },
    ]);
    expect(dataset.requests.find((request) => request.rawValue === "O/D")).toMatchObject({
      normalizedType: "OFF_OR_DAY",
      constraintMode: "REQUIRED",
    });
    expect(dataset.requests.find((request) => request.rawValue === "O/N")).toMatchObject({
      normalizedType: "OFF_OR_NIGHT",
      constraintMode: "REQUIRED",
    });

    const serialized = JSON.stringify(dataset);
    for (const staff of LIVE_SHEET_STAFF) {
      expect(serialized).not.toContain(String(staff.employeeCode));
    }
    expect(serialized).not.toContain("private-note");
  });

  it("accepts but ignores blank, duplicate, and changed employee codes", async () => {
    const original = await parseWorkbook(
      await liveGoogleSheetBytes(),
      period,
      "original.xlsx",
    );
    const ignoredCodes: Array<string | number> = LIVE_SHEET_STAFF.map(
      (staff) => staff.employeeCode,
    );
    ignoredCodes[0] = 999999;
    ignoredCodes[1] = ignoredCodes[0];
    ignoredCodes[2] = "";
    const changed = await parseWorkbook(
      await liveGoogleSheetBytes(ignoredCodes),
      period,
      "changed.xlsx",
    );

    expect(changed.nurses.map((nurse) => nurse.id)).toEqual(
      original.nurses.map((nurse) => nurse.id),
    );
    expect(JSON.stringify(changed)).not.toContain("999999");
  });

  it("still rejects a full legal name inside the legacy display column", async () => {
    const nicknames: string[] = LIVE_SHEET_STAFF.map((staff) => staff.nickname);
    nicknames[0] = "Mint Example";

    await expect(
      parseWorkbook(
        await liveGoogleSheetBytes(undefined, nicknames),
        period,
        "unsafe-live-sheet.xlsx",
      ),
    ).rejects.toThrow("single nickname or pseudonym");
  });

  it("rejects a legacy MICU roster with the wrong exact skill composition", async () => {
    const levels = LIVE_SHEET_STAFF.map((staff) => staff.level);
    levels[0] = "Member L.1";

    await expect(
      parseWorkbook(
        await liveGoogleSheetBytes(undefined, undefined, levels),
        period,
        "wrong-composition.xlsx",
      ),
    ).rejects.toThrow("requires exactly 28 nurses");
  });

  it("keeps non-standard live request tokens reviewable", async () => {
    const dataset = await parseWorkbook(
      await liveGoogleSheetBytes(),
      period,
      "live-tokens.xlsx",
    );
    const requestByRawValue = new Map(
      dataset.requests
        .filter((request) => request.rawValue)
        .map((request) => [request.rawValue, request]),
    );

    expect(requestByRawValue.get("D/N")).toMatchObject({
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D", "N", "OFF"],
      constraintMode: "PREFERENCE",
      requiresReview: true,
    });
    expect(requestByRawValue.get("D1")).toMatchObject({
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D", "N", "OFF"],
      requiresReview: true,
    });
    expect(requestByRawValue.get("O1/N")).toMatchObject({
      normalizedType: "AMBIGUOUS",
      priority: 1,
      allowedAssignments: ["OFF", "N"],
      requiresReview: true,
    });
    expect(requestByRawValue.get("VAC1")).toMatchObject({
      normalizedType: "AMBIGUOUS",
      allowedAssignments: ["D", "N", "OFF"],
      requiresReview: true,
    });
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
