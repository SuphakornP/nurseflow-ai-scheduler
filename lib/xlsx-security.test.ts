import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";

vi.mock("server-only", () => ({}));

import {
  assertSafeWorkbookDimensions,
  assertSafeXlsxArchive,
  XlsxSecurityError,
} from "@/lib/xlsx-security";

function asArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Requests").addRow(["nickname", "skill_level", "2026-08-01"]);
  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output);
}

describe("xlsx archive security", () => {
  it("accepts a bounded ordinary workbook", async () => {
    const bytes = await workbookBytes();

    expect(() => assertSafeXlsxArchive(asArrayBuffer(bytes))).not.toThrow();
  });

  it("rejects embedded active content before ExcelJS loads it", async () => {
    const zip = await JSZip.loadAsync(await workbookBytes());
    zip.file("xl/embeddings/oleObject1.bin", new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: "uint8array" });

    expect(() => assertSafeXlsxArchive(asArrayBuffer(bytes))).toThrow(XlsxSecurityError);
  });

  it("accepts Google's empty drawing placeholder but rejects drawing content", async () => {
    const emptyDrawingZip = await JSZip.loadAsync(await workbookBytes());
    emptyDrawingZip.file(
      "xl/drawings/drawing1.xml",
      '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>',
    );
    const emptyDrawingBytes = await emptyDrawingZip.generateAsync({ type: "uint8array" });

    expect(() => assertSafeXlsxArchive(asArrayBuffer(emptyDrawingBytes))).not.toThrow();

    emptyDrawingZip.file(
      "xl/drawings/drawing1.xml",
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor/></xdr:wsDr>',
    );
    const activeDrawingBytes = await emptyDrawingZip.generateAsync({ type: "uint8array" });

    expect(() => assertSafeXlsxArchive(asArrayBuffer(activeDrawingBytes))).toThrow(
      XlsxSecurityError,
    );
  });

  it("rejects drawing relationships even when the drawing placeholder is empty", async () => {
    const zip = await JSZip.loadAsync(await workbookBytes());
    zip.file(
      "xl/drawings/drawing1.xml",
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>',
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });

    expect(() => assertSafeXlsxArchive(asArrayBuffer(bytes))).toThrow(XlsxSecurityError);
  });

  it("rejects sparse worksheet dimensions before nested cell iteration", () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Requests").getCell("A2049").value = "outside contract";

    expect(() => assertSafeWorkbookDimensions(workbook)).toThrow(XlsxSecurityError);
  });
});
