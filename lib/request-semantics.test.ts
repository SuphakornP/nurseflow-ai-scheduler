import { describe, expect, it } from "vitest";

import { constraintModeForRequestValue } from "@/lib/request-semantics";

describe("request constraint classification", () => {
  it.each(["VAC", "vacation", " Vac "])("locks approved Vacation token %s", (rawValue) => {
    expect(constraintModeForRequestValue(rawValue, "MEMBER_L0")).toBe("LOCKED");
  });

  it("locks Education for non-L0 staff but keeps L0 Education soft", () => {
    expect(constraintModeForRequestValue("ชED", "MEMBER_L1")).toBe("LOCKED");
    expect(constraintModeForRequestValue("ED", "MEMBER_L0")).toBe("PREFERENCE");
  });

  it.each(["O/D", "D/O", "OFF/D", "D/OFF", "O/N", "N/O", "OFF/N", "N/OFF"])(
    "requires the flexible choice set %s",
    (rawValue) => {
      expect(constraintModeForRequestValue(rawValue, "INCHARGE")).toBe("REQUIRED");
    },
  );

  it.each(["", "D", "N", "O1", "O2", "O3", "O4", "D/N", "O1/N"])(
    "keeps soft request token %s as a preference",
    (rawValue) => {
      expect(constraintModeForRequestValue(rawValue, "INCHARGE")).toBe("PREFERENCE");
    },
  );
});
