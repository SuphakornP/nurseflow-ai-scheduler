import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/auth/request";
import {
  googleSheetExportUrl,
  ImportValidationError,
  parseWorkbook,
} from "@/lib/importer";
import { readBodyWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { cacheSourceWorkbookTemplate } from "@/lib/source-workbook-cache";
import { prepareSourceWorkbookTemplate } from "@/lib/source-workbook-template";
import type { SchedulePeriod } from "@/lib/types";

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_FILE_BYTES + 512 * 1024;
const MAX_JSON_REQUEST_BYTES = 256 * 1024;
const GOOGLE_SHEET_TIMEOUT_MS = 15_000;

const PeriodSchema = z.object({
  id: z.string().min(1).max(120),
  code: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  departmentCode: z.string().min(1).max(80),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  contextStartDate: z.iso.date(),
  contextEndDate: z.iso.date(),
  status: z.enum(["DRAFT", "READY", "GENERATED", "CONFIRMED"]),
}).strict().superRefine((period, context) => {
  const dayCount = (start: string, end: string) =>
    Math.floor(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  const periodDays = dayCount(period.startDate, period.endDate);
  if (periodDays < 1 || periodDays > 62) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The scheduling period must contain 1 to 62 days.",
    });
  }
  const contextDays = dayCount(period.contextStartDate, period.contextEndDate);
  if (
    contextDays < 1 ||
    contextDays > 62 ||
    period.contextEndDate >= period.startDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["contextEndDate"],
      message: "Previous-period context must contain 1 to 62 dates before the schedule.",
    });
  }
});

const defaultPeriod: SchedulePeriod = {
  id: "demo-micu-2026-08",
  code: "MICU-2026-08",
  name: "August 2026 Roster",
  departmentCode: "MICU",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  contextStartDate: "2026-07-29",
  contextEndDate: "2026-07-31",
  status: "DRAFT",
};

async function fetchGoogleSheet(url: string) {
  const exportUrl = googleSheetExportUrl(url);
  const response = await fetch(exportUrl, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(GOOGLE_SHEET_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ImportValidationError(
      `Google Sheet returned ${response.status}. Make the sheet accessible to anyone with the link.`,
    );
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_IMPORT_FILE_BYTES) {
    throw new ImportValidationError("The Google Sheet export exceeds 10 MB.");
  }
  try {
    return await readBodyWithLimit(response.body, MAX_IMPORT_FILE_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new ImportValidationError("The Google Sheet export exceeds 10 MB.");
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest(request, { sameOrigin: true });
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get("content-type") || "";
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_IMPORT_REQUEST_BYTES) {
      return NextResponse.json(
        { error: "IMPORT_TOO_LARGE", message: "The import request exceeds 10 MB." },
        { status: 413 },
      );
    }
    let bytes: ArrayBuffer;
    let sourceLabel: string;
    let period = defaultPeriod;

    if (contentType.includes("multipart/form-data")) {
      const multipartBytes = await readBodyWithLimit(
        request.body,
        MAX_IMPORT_REQUEST_BYTES,
      );
      const boundedRequest = new Request(request.url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: multipartBytes,
      });
      const form = await boundedRequest.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new ImportValidationError("Choose an .xlsx file to import.");
      }
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new ImportValidationError("The uploaded file exceeds 10 MB.");
      }
      if (!/\.xlsx$/i.test(file.name)) {
        throw new ImportValidationError("Only .xlsx files are supported.");
      }
      const periodValue = form.get("period");
      if (typeof periodValue === "string") period = PeriodSchema.parse(JSON.parse(periodValue));
      bytes = await file.arrayBuffer();
      sourceLabel = file.name;
    } else {
      const jsonBytes = await readBodyWithLimit(request.body, MAX_JSON_REQUEST_BYTES);
      const payload = z
        .object({ googleSheetUrl: z.url(), period: PeriodSchema.optional() })
        .strict()
        .parse(JSON.parse(new TextDecoder().decode(jsonBytes)));
      period = payload.period || defaultPeriod;
      bytes = await fetchGoogleSheet(payload.googleSheetUrl);
      sourceLabel = "Google Sheet";
    }

    const parsedDataset = await parseWorkbook(bytes, period, sourceLabel);
    const sourceTemplate = await prepareSourceWorkbookTemplate(bytes, parsedDataset);
    const dataset = {
      ...parsedDataset,
      sourceWorkbookHash: sourceTemplate.sourceHash,
    };
    cacheSourceWorkbookTemplate(dataset.period.id, sourceTemplate);
    return NextResponse.json({
      dataset,
      summary: {
        nurses: dataset.nurses.length,
        requests: dataset.requests.length,
        ambiguousValues: dataset.requests.filter((item) => item.requiresReview).length,
        vacations: dataset.requests.filter((item) => item.normalizedType === "VACATION").length,
        privacyMode: dataset.privacyMode,
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "IMPORT_TOO_LARGE", message: "The import request is too large." },
        { status: 413 },
      );
    }
    return NextResponse.json(
      {
        error: "IMPORT_FAILED",
        message:
          error instanceof ImportValidationError
            ? error.message
            : "The import could not be processed. Check the file or Google Sheet and try again.",
      },
      { status: 400 },
    );
  }
}
