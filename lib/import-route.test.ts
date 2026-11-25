import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/request", () => ({
  requireAdminRequest: vi.fn(async () => ({
    ok: true,
    session: { sessionId: "session-1", email: "admin@example.com", displayName: "Scheduler", role: "ADMIN" },
  })),
}));

import { POST } from "@/app/api/import/route";
import { getSourceWorkbookTemplate } from "@/lib/source-workbook-cache";

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

describe("POST /api/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("imports Excel context shifts and binds the sanitized template to the same login", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Requests");
    sheet.addRow(["nickname", "skill_level", "2026-07-31", "2026-08-01"]);
    sheet.addRow(["N01", "INCHARGE", "N", "O1"]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const form = new FormData();
    form.set("file", new Blob([bytes]), "mock-context.xlsx");
    form.set("period", JSON.stringify({
      ...period,
      contextStartDate: "2026-07-31",
      endDate: "2026-08-01",
    }));
    const response = await POST(new Request("http://localhost/api/import", {
      method: "POST", headers: { origin: "http://localhost" }, body: form,
    }));

    expect(response.status).toBe(200);
    const { dataset } = await response.json();
    expect(dataset.previousAssignments).toMatchObject([{ date: "2026-07-31", shift: "N" }]);
    expect(dataset.requests).toMatchObject([{ date: "2026-08-01", rawValue: "O1" }]);
    expect(getSourceWorkbookTemplate("session-1", period.id, dataset.sourceWorkbookHash)?.worksheetName)
      .toBe("Requests");
    expect(getSourceWorkbookTemplate("another-login", period.id, dataset.sourceWorkbookHash)).toBeNull();
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
