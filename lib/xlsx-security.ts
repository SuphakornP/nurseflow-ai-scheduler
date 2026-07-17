import "server-only";

import { inflateRawSync } from "node:zlib";
import type ExcelJS from "exceljs";

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 512;
const MAX_COMPRESSION_RATIO = 300;
const MAX_WORKSHEETS = 16;
// Google Sheets commonly emits style-only rows up to row 998. Bound the raw
// workbook here, then trim it to the actual roster before it reaches the solver.
const MAX_WORKSHEET_ROWS = 2048;
const MAX_WORKSHEET_COLUMNS = 256;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

interface ZipEntry {
  name: string;
  flags: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class XlsxSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxSecurityError";
  }
}

function isForbiddenPart(name: string) {
  const normalized = name.toLowerCase();
  const isDrawingPart = /^xl\/drawings\/drawing\d+\.xml$/.test(normalized);
  return (
    normalized === "xl/connections.xml" ||
    normalized.endsWith("/vbaproject.bin") ||
    normalized.startsWith("xl/externallinks/") ||
    normalized.startsWith("xl/embeddings/") ||
    normalized.startsWith("xl/activex/") ||
    normalized.startsWith("xl/ctrlprops/") ||
    normalized.startsWith("xl/querytables/") ||
    normalized.startsWith("xl/pivotcache/") ||
    normalized.startsWith("xl/media/") ||
    normalized.startsWith("customxml/") ||
    normalized.startsWith("_xmlsignatures/") ||
    (normalized.startsWith("xl/drawings/") &&
      normalized !== "xl/drawings/" &&
      !isDrawingPart)
  );
}

function zipEntryText(
  data: Uint8Array,
  view: DataView,
  entry: ZipEntry,
  directoryOffset: number,
) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== LOCAL_FILE_HEADER) {
    throw new XlsxSecurityError("The workbook ZIP entry has an invalid local header.");
  }
  const localFlags = view.getUint16(offset + 6, true);
  const localMethod = view.getUint16(offset + 8, true);
  const filenameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const filenameStart = offset + 30;
  const dataStart = filenameStart + filenameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (
    localFlags !== entry.flags ||
    localMethod !== entry.compressionMethod ||
    dataEnd > directoryOffset ||
    safeFilename(data.subarray(filenameStart, filenameStart + filenameLength)) !== entry.name
  ) {
    throw new XlsxSecurityError("The workbook ZIP entry metadata is inconsistent.");
  }

  const compressed = data.subarray(dataStart, dataEnd);
  let expanded: Uint8Array;
  try {
    expanded =
      entry.compressionMethod === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
  } catch {
    throw new XlsxSecurityError("The workbook ZIP entry could not be decompressed safely.");
  }
  if (expanded.byteLength !== entry.uncompressedSize) {
    throw new XlsxSecurityError("The workbook ZIP entry size is inconsistent.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  } catch {
    throw new XlsxSecurityError("The workbook contains invalid drawing XML.");
  }
}

function assertEmptyDrawingXml(xml: string) {
  const payload = xml
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[^?]*\?>\s*/i, "")
    .trim();
  const selfClosing = /^<((?:[A-Za-z_][\w.-]*:)?wsDr)\b[^>]*\/>$/.test(payload);
  const paired = /^<((?:[A-Za-z_][\w.-]*:)?wsDr)\b[^>]*>\s*<\/\1>$/.test(payload);
  if (!selfClosing && !paired) {
    throw new XlsxSecurityError("The workbook contains unsupported active or embedded content.");
  }
}

function safeFilename(value: Uint8Array) {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new XlsxSecurityError("The workbook contains an invalid ZIP filename.");
  }
  const segments = name.split("/");
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    segments.some((segment) => segment === "..")
  ) {
    throw new XlsxSecurityError("The workbook contains an unsafe ZIP path.");
  }
  return name;
}

export function assertSafeXlsxArchive(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  if (data.byteLength < 22 || data.byteLength > MAX_COMPRESSED_BYTES) {
    throw new XlsxSecurityError("The workbook size is outside the allowed range.");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const searchStart = Math.max(0, data.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = data.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new XlsxSecurityError("The workbook ZIP directory is missing.");

  const diskNumber = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new XlsxSecurityError("Multi-disk and ZIP64 workbooks are not supported.");
  }
  if (entryCount < 1 || entryCount > MAX_ZIP_ENTRIES) {
    throw new XlsxSecurityError("The workbook contains too many ZIP entries.");
  }
  if (
    endOffset + 22 + commentLength !== data.byteLength ||
    directoryOffset + directorySize !== endOffset
  ) {
    throw new XlsxSecurityError("The workbook ZIP directory is malformed.");
  }

  let cursor = directoryOffset;
  let uncompressedTotal = 0;
  const names = new Set<string>();
  const drawingEntries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new XlsxSecurityError("The workbook ZIP entry is malformed.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const filenameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + filenameLength + extraLength + entryCommentLength;
    if (next > endOffset || localHeaderOffset >= directoryOffset) {
      throw new XlsxSecurityError("The workbook ZIP entry points outside the archive.");
    }
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compressionMethod)) {
      throw new XlsxSecurityError("Encrypted or unsupported ZIP entries are not allowed.");
    }
    const name = safeFilename(data.subarray(cursor + 46, cursor + 46 + filenameLength));
    if (names.has(name)) throw new XlsxSecurityError("Duplicate ZIP entries are not allowed.");
    if (isForbiddenPart(name)) {
      throw new XlsxSecurityError("The workbook contains unsupported active or embedded content.");
    }
    if (/^xl\/drawings\/drawing\d+\.xml$/i.test(name)) {
      drawingEntries.push({
        name,
        flags,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    names.add(name);
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new XlsxSecurityError("The expanded workbook exceeds 64 MB.");
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw new XlsxSecurityError("The workbook contains an unsafe compression ratio.");
    }
    cursor = next;
  }
  if (cursor !== endOffset) throw new XlsxSecurityError("The workbook ZIP directory is inconsistent.");
  for (const entry of drawingEntries) {
    assertEmptyDrawingXml(zipEntryText(data, view, entry, directoryOffset));
  }
  if (
    !names.has("[Content_Types].xml") ||
    !names.has("xl/workbook.xml") ||
    ![...names].some((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
  ) {
    throw new XlsxSecurityError("The archive is not a supported xlsx workbook.");
  }
}

export function assertSafeWorkbookDimensions(workbook: ExcelJS.Workbook) {
  if (workbook.worksheets.length < 1 || workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new XlsxSecurityError("The workbook contains an unsupported number of worksheets.");
  }
  for (const worksheet of workbook.worksheets) {
    if (
      worksheet.rowCount > MAX_WORKSHEET_ROWS ||
      worksheet.columnCount > MAX_WORKSHEET_COLUMNS
    ) {
      throw new XlsxSecurityError("The workbook worksheet dimensions exceed the safe limit.");
    }
  }
}
