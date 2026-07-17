import { describe, expect, it } from "vitest";

import { assignmentsForNormalizationCandidate } from "@/lib/normalization-candidate";

describe("normalization candidate assignments", () => {
  it("derives locked event assignments from the normalized type", () => {
    expect(
      assignmentsForNormalizationCandidate(
        { normalizedType: "VACATION", allowedAssignments: ["D"] },
        ["D", "N", "OFF"],
      ),
    ).toEqual(["VAC"]);
    expect(
      assignmentsForNormalizationCandidate(
        { normalizedType: "EDUCATION", allowedAssignments: ["VAC"] },
        ["D", "N", "OFF"],
      ),
    ).toEqual(["ED"]);
  });

  it("ignores unsupported AI types and their inconsistent assignments", () => {
    expect(
      assignmentsForNormalizationCandidate(
        { normalizedType: "UNKNOWN", allowedAssignments: ["VAC"] },
        ["D"],
      ),
    ).toEqual(["D"]);
  });

  it("uses canonical choice sets for supported flexible types", () => {
    expect(
      assignmentsForNormalizationCandidate(
        { normalizedType: "OFF_OR_NIGHT", allowedAssignments: ["VAC"] },
        ["D", "N", "OFF"],
      ),
    ).toEqual(["OFF", "N"]);
    expect(
      assignmentsForNormalizationCandidate(
        { normalizedType: "DAY_OR_NIGHT", allowedAssignments: [] },
        ["D", "N", "OFF"],
      ),
    ).toEqual(["D", "N"]);
  });
});
