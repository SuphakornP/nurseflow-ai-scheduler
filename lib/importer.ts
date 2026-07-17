import "server-only";

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { normalizeRequestValue } from "@/lib/normalizer";
import { constraintModeForRequestValue } from "@/lib/request-semantics";
import {
  assertSafeWorkbookDimensions,
  assertSafeXlsxArchive,
  XlsxSecurityError,
} from "@/lib/xlsx-security";
import type {
  Assignment,
  Nurse,
  ScheduleDataset,
  SchedulePeriod,
  ShiftCode,
  ShiftRequest,
  SkillLevel,
} from "@/lib/types";
import { getDates } from "@/lib/utils";

const HEADER_ALIASES = {
  nickname: ["nickname", "nick name", "ชื่อเล่น", "ชื่อเล่น (nickname)"],
  skill: ["skill", "skill level", "skill_level", "level", "ระดับ", "ตำแหน่ง"],
};

// Compatibility for the supplied hospital request form. Employee codes identify
// the layout only; they are never copied into the normalized dataset.
const LEGACY_REQUEST_SHEET_HEADERS = {
  employeeCode: ["รหัสพนักงาน", "employee code", "employee_code", "emp code", "empcode"],
  displayNickname: ["ชื่อ - สกุล", "ชื่อ-สกุล"],
};

const PROHIBITED_IDENTITY_HEADERS = new Set([
  "first name",
  "firstname",
  "last name",
  "lastname",
  "full name",
  "fullname",
  "name",
  "employee name",
  "ชื่อจริง",
  "ชื่อ-สกุล",
  "ชื่อ - สกุล",
  "ชื่อ นามสกุล",
  "นามสกุล",
]);

const SKILL_ALIASES: Record<string, SkillLevel> = {
  INCHARGE: "INCHARGE",
  INC: "INCHARGE",
  "TRAINEE INC": "TRAINEE_INC",
  "TRAINEE INC.": "TRAINEE_INC",
  TRAINEE_INC: "TRAINEE_INC",
  TRAINEE: "TRAINEE_INC",
  "MEMBER L1": "MEMBER_L1",
  "MEMBER L.1": "MEMBER_L1",
  "MEMBER LEVEL 1": "MEMBER_L1",
  MEMBER_L1: "MEMBER_L1",
  L1: "MEMBER_L1",
  "MEMBER L2": "MEMBER_L2",
  "MEMBER L.2": "MEMBER_L2",
  "MEMBER LEVEL 2": "MEMBER_L2",
  MEMBER_L2: "MEMBER_L2",
  L2: "MEMBER_L2",
  "MEMBER L0": "MEMBER_L0",
  "MEMBER L.0": "MEMBER_L0",
  "MEMBER LEVEL 0": "MEMBER_L0",
  MEMBER_L0: "MEMBER_L0",
  L0: "MEMBER_L0",
};

const MICU_LEGACY_COMPOSITION: Record<SkillLevel, number> = {
  INCHARGE: 8,
  TRAINEE_INC: 4,
  MEMBER_L1: 11,
  MEMBER_L2: 4,
  MEMBER_L0: 1,
};

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("result" in value) return value.result ?? "";
  if ("richText" in value) return value.richText.map((item) => item.text).join("");
  if ("text" in value) return value.text;
  return String(value);
}

function headerKey(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function stableId(value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function parseSkill(value: unknown): SkillLevel {
  const skill = SKILL_ALIASES[text(value).toUpperCase().replace(/\s+/g, " ")];
  if (!skill) throw new ImportValidationError(`Unknown skill level: ${text(value) || "(blank)"}`);
  return skill;
}

function assertNickname(value: unknown, rowNumber: number) {
  const nickname = text(value);
  if (!nickname) throw new ImportValidationError(`Row ${rowNumber}: nickname is required.`);
  if (nickname.length > 32) {
    throw new ImportValidationError(`Row ${rowNumber}: nickname must be 32 characters or fewer.`);
  }
  if (/\s{1,}/.test(nickname)) {
    throw new ImportValidationError(
      `Row ${rowNumber}: use a single nickname or pseudonym, not a first/last name.`,
    );
  }
  return nickname;
}

function explicitHeaderDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function resolveDateColumns(headers: unknown[], expectedDates: string[]) {
  const usedDates = new Set<string>();
  let lastExpectedIndex = -1;

  return headers.flatMap((value, index) => {
    const explicitDate = explicitHeaderDate(value);
    if (explicitDate) {
      const expectedIndex = expectedDates.indexOf(explicitDate);
      if (expectedIndex >= 0) {
        usedDates.add(explicitDate);
        lastExpectedIndex = expectedIndex;
      }
      return [{ index, date: explicitDate }];
    }

    const raw = text(value);
    if (!/^\d{1,2}$/.test(raw)) return [];

    const day = Number(raw);
    const candidates = expectedDates.filter(
      (date) => Number(date.slice(-2)) === day && !usedDates.has(date),
    );
    const date =
      candidates.find((candidate) => expectedDates.indexOf(candidate) > lastExpectedIndex) ??
      candidates[0];
    if (!date) return [];

    usedDates.add(date);
    lastExpectedIndex = expectedDates.indexOf(date);
    return [{ index, date }];
  });
}

function previousShift(value: unknown): ShiftCode | null {
  const cleaned = text(value).toUpperCase();
  if (["D", "DAY"].includes(cleaned)) return "D";
  if (["N", "NIGHT"].includes(cleaned)) return "N";
  if (["O", "OFF"].includes(cleaned)) return "OFF";
  if (["VAC", "VACATION"].includes(cleaned)) return "VAC";
  if (["ED", "ชED"].includes(cleaned)) return "ED";
  return null;
}

export async function parseWorkbook(
  bytes: ArrayBuffer,
  period: SchedulePeriod,
  sourceLabel: string,
): Promise<ScheduleDataset> {
  try {
    assertSafeXlsxArchive(bytes);
  } catch (error) {
    if (error instanceof XlsxSecurityError) {
      throw new ImportValidationError(error.message);
    }
    throw error;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  try {
    assertSafeWorkbookDimensions(workbook);
  } catch (error) {
    if (error instanceof XlsxSecurityError) {
      throw new ImportValidationError(error.message);
    }
    throw error;
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ImportValidationError("The workbook does not contain a worksheet.");
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values: unknown[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      values.push(cellValue(row.getCell(column).value));
    }
    rows.push(values);
  });
  if (rows.length < 2) {
    throw new ImportValidationError("The worksheet does not contain staff rows.");
  }

  const headerRowIndex = rows.slice(0, 20).findIndex((row) => {
    const keys = row.map(headerKey);
    const hasStandardNickname = HEADER_ALIASES.nickname.some((alias) => keys.includes(alias));
    const hasLegacyIdentity =
      LEGACY_REQUEST_SHEET_HEADERS.employeeCode.some((alias) => keys.includes(alias)) &&
      LEGACY_REQUEST_SHEET_HEADERS.displayNickname.some((alias) => keys.includes(alias));
    return (
      (hasStandardNickname || hasLegacyIdentity) &&
      HEADER_ALIASES.skill.some((alias) => keys.includes(alias))
    );
  });
  if (headerRowIndex < 0) {
    throw new ImportValidationError(
      "Could not find a header row. Include `nickname`, `skill_level`, and date columns.",
    );
  }

  const headers = rows[headerRowIndex];
  const standardNicknameColumn = headers.findIndex((value) =>
    HEADER_ALIASES.nickname.includes(headerKey(value)),
  );
  const employeeCodeColumn = headers.findIndex((value) =>
    LEGACY_REQUEST_SHEET_HEADERS.employeeCode.includes(headerKey(value)),
  );
  const legacyNicknameColumn = headers.findIndex((value) =>
    LEGACY_REQUEST_SHEET_HEADERS.displayNickname.includes(headerKey(value)),
  );
  const usesLegacyRequestSheet =
    standardNicknameColumn < 0 && employeeCodeColumn >= 0 && legacyNicknameColumn >= 0;
  const nicknameColumn = usesLegacyRequestSheet ? legacyNicknameColumn : standardNicknameColumn;
  const prohibitedHeader = headers
    .map((value, index) => ({ index, value: headerKey(value) }))
    .find(
      ({ index, value }) =>
        PROHIBITED_IDENTITY_HEADERS.has(value) &&
        !(usesLegacyRequestSheet && index === nicknameColumn),
    )?.value;
  if (prohibitedHeader) {
    throw new ImportValidationError(
      `Remove the \`${prohibitedHeader}\` column before import. NurseFlow accepts nickname or pseudonym only.`,
    );
  }
  const skillColumn = headers.findIndex((value) =>
    HEADER_ALIASES.skill.includes(headerKey(value)),
  );
  const expectedDates = [
    ...getDates(period.contextStartDate, period.contextEndDate),
    ...getDates(period.startDate, period.endDate),
  ];
  const dateColumns = resolveDateColumns(headers, expectedDates);
  const expectedDateSet = new Set(expectedDates);
  const availableDates = new Set(dateColumns.map((item) => item.date));
  const missingDates = expectedDates.filter((date) => !availableDates.has(date));
  if (missingDates.length) {
    throw new ImportValidationError(
      `Missing date columns: ${missingDates.slice(0, 6).join(", ")}`,
    );
  }

  const nurses: Nurse[] = [];
  const requests: ShiftRequest[] = [];
  const previousAssignments: Assignment[] = [];
  const seenNicknames = new Set<string>();

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    if (!row.some((value) => text(value))) return;
    const rowNumber = headerRowIndex + offset + 2;
    const nickname = assertNickname(row[nicknameColumn], rowNumber);
    const nicknameKey = nickname.toLocaleLowerCase("th-TH");
    if (seenNicknames.has(nicknameKey)) {
      throw new ImportValidationError(
        `Row ${rowNumber}: duplicate nickname ${nickname}. Use a unique pseudonym.`,
      );
    }
    seenNicknames.add(nicknameKey);
    const nurseId = stableId(`${period.id}:${nicknameKey}`);
    const skillLevel = parseSkill(row[skillColumn]);
    nurses.push({ id: nurseId, nickname, skillLevel });

    dateColumns.forEach(({ index, date }) => {
      if (!expectedDateSet.has(date)) return;
      if (date >= period.startDate && date <= period.endDate) {
        requests.push(
          normalizeRequestValue(
            row[index],
            nurseId,
            date,
            constraintModeForRequestValue(row[index], skillLevel),
          ),
        );
      } else {
        const shift = previousShift(row[index]);
        if (!shift) {
          throw new ImportValidationError(
            `Row ${rowNumber}, ${date}: previous assignment is required.`,
          );
        }
        previousAssignments.push({
          nurseId,
          date,
          shift,
          source: "LOCKED_REQUEST",
        });
      }
    });
  });

  if (!nurses.length) throw new ImportValidationError("No nurse rows were found.");
  if (usesLegacyRequestSheet) {
    const counts = Object.fromEntries(
      Object.keys(MICU_LEGACY_COMPOSITION).map((skillLevel) => [
        skillLevel,
        nurses.filter((nurse) => nurse.skillLevel === skillLevel).length,
      ]),
    ) as Record<SkillLevel, number>;
    const mismatches = (Object.entries(MICU_LEGACY_COMPOSITION) as Array<
      [SkillLevel, number]
    >).filter(([skillLevel, expected]) => counts[skillLevel] !== expected);
    if (mismatches.length) {
      throw new ImportValidationError(
        `The MICU request form requires exactly 28 nurses: ${mismatches
          .map(
            ([skillLevel, expected]) =>
              `${skillLevel} ${expected} (found ${counts[skillLevel]})`,
          )
          .join(", ")}.`,
      );
    }
  }
  return {
    period,
    nurses,
    requests,
    previousAssignments,
    sourceLabel,
    privacyMode: "NICKNAME_ONLY",
  };
}

export function googleSheetExportUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new ImportValidationError("Only HTTPS Google Sheets URLs on docs.google.com are allowed.");
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new ImportValidationError("The Google Sheets URL is invalid.");
  const gid = url.searchParams.get("gid") || "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx&gid=${gid}`;
}
