import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDemoResponse } from "@/components/demo-data";
import { NurseFlowWorkspace } from "@/components/nurseflow-workspace";
import { ScheduleMatrix } from "@/components/schedule-matrix";
import { getWorkspaceConfirmationGate } from "@/components/workspace-confirmation";
import type { ScheduleVersion } from "@/lib/types";

describe("temporary scheduling workspace", () => {
  it("allows one final choice per calculation while allowing a new run to choose again", () => {
    const candidates: ScheduleVersion[] = createDemoResponse().versions.map((version) => ({
      ...version, solverStatus: "FEASIBLE",
    }));
    const confirmed: ScheduleVersion = { ...candidates[0], status: "CONFIRMED" };
    const run = [confirmed, ...candidates.slice(1)];

    expect(getWorkspaceConfirmationGate(run[1], run)).toMatchObject({
      state: "BLOCKED", summary: "Version 1 confirmed",
    });
    expect(getWorkspaceConfirmationGate(confirmed, run).state).toBe("CONFIRMED");
    expect(getWorkspaceConfirmationGate(candidates[1], candidates).state).toBe("READY");
  });

  it("opens at Excel intake and requires solver results before exporting or confirming", () => {
    const html = renderToStaticMarkup(createElement(NurseFlowWorkspace, { displayName: "Scheduler" }));

    expect(html).toContain('type="file"');
    expect(html).toContain("Previous days in workbook");
    expect(html).toContain("Load synthetic demo");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Export<\/button>/);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Confirm v\d+<\/button>/);
  });

  it("displays the imported month and assignments in the selected date window", () => {
    const { dataset, versions } = createDemoResponse();
    const nurse = dataset.nurses[0];
    const html = renderToStaticMarkup(createElement(ScheduleMatrix, {
      nurses: [{ ...nurse, synthetic: false }],
      version: {
        ...versions[0],
        assignments: [{ nurseId: nurse.id, date: "2028-02-29", shift: "N", source: "SOLVER" }],
      },
      dates: ["2028-02-29"],
      periodName: "February 2028 roster",
      onSelect: () => {},
    }));

    expect(html).toContain("February 2028 roster for 1 nickname-only imported request records");
    expect(html).toContain(`aria-label="${nurse.nickname}, 2028-02-29, Night"`);
    expect(html.match(/class="shift-cell"/g)).toHaveLength(1);
  });
});
