import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cacheSourceWorkbookTemplate,
  getSourceWorkbookTemplate,
} from "@/lib/source-workbook-cache";
import type { SourceWorkbookTemplate } from "@/lib/source-workbook-template";

function template(marker: number): SourceWorkbookTemplate {
  return {
    bytes: new Uint8Array([marker]),
    sourceHash: marker.toString(16).padStart(64, "0"),
    worksheetName: "Requests",
    nurseRows: { "nurse-1": 3 },
    dateColumns: { "2026-08-01": 7 },
  };
}

describe("source workbook cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds retained monthly templates and evicts the oldest entry", () => {
    for (let index = 1; index <= 5; index += 1) {
      cacheSourceWorkbookTemplate("session-1", `period-${index}`, template(index));
    }

    expect(getSourceWorkbookTemplate("session-1", "period-1", template(1).sourceHash)).toBeNull();
    expect(getSourceWorkbookTemplate("session-1", "period-5", template(5).sourceHash)?.bytes)
      .toEqual(new Uint8Array([5]));
  });

  it("expires templates rather than exporting stale source data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    cacheSourceWorkbookTemplate("session-1", "period-1", template(1));
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1);

    expect(getSourceWorkbookTemplate("session-1", "period-1", template(1).sourceHash)).toBeNull();
  });

  it("keeps same-period imports distinct and scoped to the authenticated session", () => {
    const first = template(1);
    const second = template(2);
    cacheSourceWorkbookTemplate("session-1", "period-1", first);
    cacheSourceWorkbookTemplate("session-1", "period-1", second);

    expect(getSourceWorkbookTemplate("session-1", "period-1", first.sourceHash)).toBe(first);
    expect(getSourceWorkbookTemplate("session-1", "period-1", second.sourceHash)).toBe(second);
    expect(getSourceWorkbookTemplate("session-2", "period-1", first.sourceHash)).toBeNull();
    expect(getSourceWorkbookTemplate("session-1", "period-1", "f".repeat(64))).toBeNull();
  });
});
