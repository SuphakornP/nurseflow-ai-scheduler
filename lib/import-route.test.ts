import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/request", () => ({
  requireAdminRequest: vi.fn(async () => ({
    ok: true,
    session: { email: "admin@example.com", displayName: "Scheduler", role: "ADMIN" },
  })),
}));

vi.mock("@/lib/importer", () => {
  class ImportValidationError extends Error {}
  return {
    ImportValidationError,
    googleSheetExportUrl: vi.fn((value: string) => value),
    parseWorkbook: vi.fn(),
  };
});
vi.mock("@/lib/source-workbook-cache", () => ({
  cacheSourceWorkbookTemplate: vi.fn(),
}));
vi.mock("@/lib/source-workbook-template", () => ({
  prepareSourceWorkbookTemplate: vi.fn(),
}));

import { POST } from "@/app/api/import/route";

function jsonRequest(period: Record<string, unknown>) {
  return new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({
      googleSheetUrl: "https://docs.google.com/spreadsheets/d/synthetic/edit",
      period,
    }),
  });
}

const period = {
  id: "period-1",
  code: "MICU-2026-08",
  name: "August roster",
  departmentCode: "MICU",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  contextStartDate: "2026-07-29",
  contextEndDate: "2026-07-31",
  status: "DRAFT",
};

describe("POST /api/import bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("rejects an oversized scheduling period before fetching the Sheet", async () => {
    const response = await POST(
      jsonRequest({ ...period, endDate: "2027-12-31" }),
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("streams and rejects a chunked multipart body above the route limit", async () => {
    const response = await POST(
      new Request("http://localhost/api/import", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=synthetic",
          origin: "http://localhost",
        },
        body: new Uint8Array(10 * 1024 * 1024 + 512 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "IMPORT_TOO_LARGE" });
  });
});
