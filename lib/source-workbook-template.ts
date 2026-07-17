import "server-only";

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ScheduleDataset } from "@/lib/types";
import { getDates } from "@/lib/utils";
import {
  assertSafeWorkbookDimensions,
  assertSafeXlsxArchive,
} from "@/lib/xlsx-security";

const NICKNAME_HEADERS = ["nickname", "nick name", "ชื่อเล่น", "ชื่อเล่น (nickname)"];
const LEGACY_NICKNAME_HEADERS = ["ชื่อ - สกุล", "ชื่อ-สกุล"];
const SKILL_HEADERS = ["skill", "skill level", "skill_level", "level", "ระดับ", "ตำแหน่ง"];
const EMPLOYEE_CODE_HEADERS = [
  "รหัสพนักงาน",
  "employee code",
  "employee_code",
  "emp code",
  "empcode",
];
const NOTE_HEADERS = ["หมายเหตุ", "note", "notes"];
const MAX_SANITIZED_WORKBOOK_BYTES = 10 * 1024 * 1024;

export interface SourceWorkbookTemplate {
  bytes: Uint8Array;
  sourceHash: string;
  worksheetName: string;
  nurseRows: Record<string, number>;
  dateColumns: Record<string, number>;
}

export interface SolverSourceWorkbookTemplate {
  content_base64: string;
  worksheet_name: string;
  nurse_rows: Record<string, number>;
  date_columns: Record<string, number>;
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

function staticCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  const resolved = cellValue(value);
  if (
    resolved === null ||
    typeof resolved === "string" ||
    typeof resolved === "number" ||
    typeof resolved === "boolean" ||
    resolved instanceof Date
  ) {
    return resolved;
  }
  return null;
}

function arrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function addSensitiveToken(tokens: Set<string>, value: unknown) {
  const candidate = text(value);
  if (candidate.length >= 4 && candidate.length <= 512) tokens.add(candidate);
}

function addCommentTokens(tokens: Set<string>, note: ExcelJS.Cell["note"] | undefined) {
  if (!note) return;
  if (typeof note === "string") {
    addSensitiveToken(tokens, note);
    return;
  }
  for (const item of note.texts ?? []) addSensitiveToken(tokens, item.text);
}

function addActiveContentTokens(tokens: Set<string>, value: ExcelJS.CellValue) {
  if (value === null || typeof value !== "object" || value instanceof Date) return;
  if ("formula" in value) addSensitiveToken(tokens, value.formula);
  if ("sharedFormula" in value) addSensitiveToken(tokens, value.sharedFormula);
  if ("hyperlink" in value) addSensitiveToken(tokens, value.hyperlink);
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function assertSensitiveContentRemoved(bytes: Uint8Array, tokens: Set<string>) {
  const archive = await JSZip.loadAsync(bytes);
  const remainingParts = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name.toLowerCase());
  if (
    remainingParts.some(
      (name) =>
        name.startsWith("xl/drawings/") ||
        name.startsWith("xl/persons/") ||
        name.startsWith("xl/threadedcomments/") ||
        /^xl\/comments\d+\.xml$/.test(name),
    )
  ) {
    throw new Error("Unsupported source annotations remained after workbook sanitization.");
  }
  if (!tokens.size) return;
  const textEntries = Object.values(archive.files).filter(
    (entry) => !entry.dir && /\.(?:xml|rels|vml|txt)$/i.test(entry.name),
  );
  for (const entry of textEntries) {
    const content = await entry.async("string");
    for (const token of tokens) {
      if (content.includes(token) || content.includes(xmlEscape(token))) {
        throw new Error("Sensitive source content remained after workbook sanitization.");
      }
    }
  }
}

function headerKey(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function explicitHeaderDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
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
        return [{ column: index + 1, date: explicitDate }];
      }
      return [];
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
    return [{ column: index + 1, date }];
  });
}

function rowValues(worksheet: ExcelJS.Worksheet, rowNumber: number) {
  const row = worksheet.getRow(rowNumber);
  return Array.from({ length: worksheet.columnCount }, (_, index) =>
    cellValue(row.getCell(index + 1).value),
  );
}

function includesHeader(headers: unknown[], aliases: string[]) {
  return headers.some((value) => aliases.includes(headerKey(value)));
}

export async function prepareSourceWorkbookTemplate(
  bytes: ArrayBuffer,
  dataset: ScheduleDataset,
): Promise<SourceWorkbookTemplate> {
  assertSafeXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assertSafeWorkbookDimensions(workbook);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The source workbook does not contain a worksheet.");

  let headerRowNumber = 0;
  let headers: unknown[] = [];
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber += 1) {
    const candidate = rowValues(worksheet, rowNumber);
    const hasNickname = includesHeader(candidate, NICKNAME_HEADERS);
    const hasLegacyNickname =
      includesHeader(candidate, LEGACY_NICKNAME_HEADERS) &&
      includesHeader(candidate, EMPLOYEE_CODE_HEADERS);
    if ((hasNickname || hasLegacyNickname) && includesHeader(candidate, SKILL_HEADERS)) {
      headerRowNumber = rowNumber;
      headers = candidate;
      break;
    }
  }
  if (!headerRowNumber) throw new Error("The source workbook header row could not be located.");

  const nicknameColumnIndex = headers.findIndex((value) =>
    [...NICKNAME_HEADERS, ...LEGACY_NICKNAME_HEADERS].includes(headerKey(value)),
  );
  if (nicknameColumnIndex < 0) throw new Error("The source nickname column could not be located.");

  const employeeCodeColumnIndex = headers.findIndex((value) =>
    EMPLOYEE_CODE_HEADERS.includes(headerKey(value)),
  );
  const noteColumnIndex = headers.findIndex((value) => NOTE_HEADERS.includes(headerKey(value)));
  const skillColumnIndex = headers.findIndex((value) => SKILL_HEADERS.includes(headerKey(value)));

  const nurseByNickname = new Map(
    dataset.nurses.map((nurse) => [nurse.nickname.toLocaleLowerCase("th-TH"), nurse]),
  );
  const nurseRows: Record<string, number> = {};
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const nickname = text(cellValue(worksheet.getRow(rowNumber).getCell(nicknameColumnIndex + 1).value));
    const nurse = nurseByNickname.get(nickname.toLocaleLowerCase("th-TH"));
    if (nurse) nurseRows[nurse.id] = rowNumber;

  }
  if (Object.keys(nurseRows).length !== dataset.nurses.length) {
    throw new Error("The source workbook roster no longer matches the normalized dataset.");
  }

  const expectedDates = [
    ...getDates(dataset.period.contextStartDate, dataset.period.contextEndDate),
    ...getDates(dataset.period.startDate, dataset.period.endDate),
  ];
  const resolvedDates = resolveDateColumns(headers, expectedDates);
  const dateColumns = Object.fromEntries(
    resolvedDates
      .filter(({ date }) => date >= dataset.period.startDate && date <= dataset.period.endDate)
      .map(({ date, column }) => [date, column]),
  );
  const expectedPeriodDates = getDates(dataset.period.startDate, dataset.period.endDate);
  if (Object.keys(dateColumns).length !== expectedPeriodDates.length) {
    throw new Error("The source workbook does not contain every scheduling date.");
  }

  const sensitiveTokens = new Set<string>();
  const rosterRows = new Set(Object.values(nurseRows));
  const allowedRosterColumns = new Set([
    nicknameColumnIndex + 1,
    skillColumnIndex + 1,
    ...resolvedDates.map(({ column }) => column),
  ]);
  for (const value of [
    workbook.creator,
    workbook.lastModifiedBy,
    workbook.title,
    workbook.subject,
    workbook.keywords,
    workbook.category,
    workbook.description,
    workbook.company,
    workbook.manager,
  ]) {
    addSensitiveToken(sensitiveTokens, value);
  }
  for (const definedName of workbook.definedNames.model) {
    addSensitiveToken(sensitiveTokens, definedName.name);
    for (const range of definedName.ranges) addSensitiveToken(sensitiveTokens, range);
  }
  for (const extraWorksheet of workbook.worksheets.slice(1)) {
    addSensitiveToken(sensitiveTokens, extraWorksheet.name);
    extraWorksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        addSensitiveToken(sensitiveTokens, cellValue(cell.value));
        addActiveContentTokens(sensitiveTokens, cell.value);
        addCommentTokens(sensitiveTokens, cell.note);
      });
    });
  }

  // Retain only the scheduling template. This prevents hidden or unrelated sheets
  // from being copied into a later export.
  for (const extraWorksheet of workbook.worksheets.slice(1)) {
    workbook.removeWorksheet(extraWorksheet.id);
  }
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const cell = worksheet.getRow(rowNumber).getCell(column);
      const value = cell.value;
      addActiveContentTokens(sensitiveTokens, value);
      const isRosterRow = rosterRows.has(rowNumber);
      const shouldClear =
        rowNumber > headerRowNumber &&
        (!isRosterRow || !allowedRosterColumns.has(column));
      const hiddenSourceCell =
        rowNumber < headerRowNumber &&
        (worksheet.getRow(rowNumber).hidden || worksheet.getColumn(column).hidden);
      if (shouldClear || hiddenSourceCell) {
        addSensitiveToken(sensitiveTokens, cellValue(value));
        cell.value = null;
      }
      if (
        rowNumber > headerRowNumber &&
        (column === employeeCodeColumnIndex + 1 || column === noteColumnIndex + 1)
      ) {
        addSensitiveToken(sensitiveTokens, cellValue(value));
        cell.value = null;
      }
      if (
        cell.value !== null &&
        typeof cell.value === "object" &&
        !(cell.value instanceof Date) &&
        ("formula" in cell.value || "sharedFormula" in cell.value || "hyperlink" in cell.value)
      ) {
        cell.value = staticCellValue(cell.value);
      }
      addCommentTokens(sensitiveTokens, cell.note);
      // ExcelJS's public note setter creates a new note even for undefined, so
      // removal requires clearing the library's backing field before serialization.
      Reflect.deleteProperty(cell, "_comment");
      Reflect.deleteProperty(cell.model, "comment");
    }
  }
  const lastRosterRow = Math.max(headerRowNumber, ...rosterRows);
  if (worksheet.rowCount > lastRosterRow) {
    worksheet.spliceRows(lastRosterRow + 1, worksheet.rowCount - lastRosterRow);
  }
  workbook.creator = "NurseFlow AI";
  workbook.lastModifiedBy = "NurseFlow AI";
  workbook.title = "";
  workbook.subject = "";
  workbook.keywords = "";
  workbook.category = "";
  workbook.description = "";
  workbook.company = "";
  workbook.manager = "";
  workbook.definedNames.model = [];

  const sanitized = await workbook.xlsx.writeBuffer();
  if (sanitized.byteLength > MAX_SANITIZED_WORKBOOK_BYTES) {
    throw new Error("The sanitized source workbook exceeds 10 MB.");
  }
  const sanitizedBytes = new Uint8Array(sanitized);
  assertSafeXlsxArchive(arrayBuffer(sanitizedBytes));
  await assertSensitiveContentRemoved(sanitizedBytes, sensitiveTokens);
  return {
    bytes: sanitizedBytes,
    sourceHash: createHash("sha256").update(sanitizedBytes).digest("hex"),
    worksheetName: worksheet.name,
    nurseRows,
    dateColumns,
  };
}

export function sourceWorkbookTemplateToSolverPayload(
  template: SourceWorkbookTemplate,
): SolverSourceWorkbookTemplate {
  return {
    content_base64: Buffer.from(template.bytes).toString("base64"),
    worksheet_name: template.worksheetName,
    nurse_rows: template.nurseRows,
    date_columns: template.dateColumns,
  };
}
