import { describe, expect, it } from "vitest";
import { normalizeRequestValue } from "@/lib/normalizer";

describe("normalizeRequestValue", () => {
  it.each(["Vac", "VAC", " vac ", "vacation"])("locks vacation alias %s", (raw) => {
    const result = normalizeRequestValue(raw, "n1", "2026-08-01");
    expect(result.normalizedType).toBe("VACATION");
    expect(result.allowedAssignments).toEqual(["VAC"]);
    expect(result.requiresReview).toBe(false);
  });

  it.each(["ชED", "ชed", "ED"])("locks education alias %s", (raw) => {
    expect(normalizeRequestValue(raw, "n1", "2026-08-01").normalizedType).toBe(
      "EDUCATION",
    );
  });

  it("normalizes priorities and flexible requests", () => {
    expect(normalizeRequestValue("O1", "n1", "2026-08-01").priority).toBe(1);
    expect(normalizeRequestValue("D/O", "n1", "2026-08-01").allowedAssignments).toEqual([
      "OFF",
      "D",
    ]);
    expect(normalizeRequestValue("N/O", "n1", "2026-08-01").allowedAssignments).toEqual([
      "OFF",
      "N",
    ]);
  });

  it("requires review for ambiguous or unknown values", () => {
    expect(normalizeRequestValue("O1/N", "n1", "2026-08-01").requiresReview).toBe(true);
    expect(normalizeRequestValue("D1", "n1", "2026-08-01").requiresReview).toBe(true);
  });
});
