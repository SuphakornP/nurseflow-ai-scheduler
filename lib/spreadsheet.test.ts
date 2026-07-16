import { describe, expect, it } from "vitest";

import { csvCell, spreadsheetSafeText } from "@/lib/spreadsheet";

describe("spreadsheet text safety", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)"])(
    "neutralizes formula-like cell text: %s",
    (value) => {
      expect(spreadsheetSafeText(value)).toBe(`'${value}`);
    },
  );

  it("escapes quotes after neutralizing formulas for CSV", () => {
    expect(csvCell('="danger"')).toBe('"\'=\"\"danger\"\""');
  });
});
