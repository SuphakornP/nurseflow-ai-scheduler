import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cacheSourceWorkbookTemplate,
  getSourceWorkbookTemplate,
  resetSourceWorkbookTemplateCacheForTests,
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
  beforeEach(() => {
    resetSourceWorkbookTemplateCacheForTests();
    vi.useRealTimers();
  });

  it("bounds retained monthly templates and evicts the oldest entry", () => {
    for (let index = 1; index <= 5; index += 1) {
      cacheSourceWorkbookTemplate(`period-${index}`, template(index));
    }

    expect(getSourceWorkbookTemplate("period-1")).toBeNull();
    expect(getSourceWorkbookTemplate("period-5")?.bytes).toEqual(new Uint8Array([5]));
  });

  it("expires templates rather than exporting stale source data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    cacheSourceWorkbookTemplate("period-1", template(1));
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1);

    expect(getSourceWorkbookTemplate("period-1")).toBeNull();
  });

  it("does not return a template from a different import snapshot", () => {
    const cached = template(1);
    cacheSourceWorkbookTemplate("period-1", cached);

    expect(getSourceWorkbookTemplate("period-1", "f".repeat(64))).toBeNull();
    expect(getSourceWorkbookTemplate("period-1", cached.sourceHash)).toBe(cached);
  });
});
