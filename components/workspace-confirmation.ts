import { getConfirmationGatePresentation } from "@/lib/confirmation-eligibility";
import type { ScheduleVersion } from "@/lib/types";

function blocked(label: string, summary: string, description: string) {
  return {
    state: "BLOCKED" as const,
    className: "is-blocked" as const,
    label,
    summary,
    description,
    disabledReason: description,
  };
}

export function getWorkspaceConfirmationGate(
  version: ScheduleVersion | undefined,
  versions: readonly ScheduleVersion[],
  { hasUnimportedSource = false, hasPendingDataset = false } = {},
) {
  if (hasUnimportedSource) {
    return blocked(
      "Source selected",
      "Review the selected source first",
      "Review the selected source before calculating or exporting a roster.",
    );
  }
  if (hasPendingDataset) {
    return blocked(
      "Blocked",
      "Generate imported requests first",
      "Generate and validate candidates for the imported workbook before confirming a version.",
    );
  }
  if (version?.solverStatus === "DEMO") {
    return blocked(
      "Preview",
      "Generate candidates first",
      "Calculate candidates with the solver before confirming or exporting a schedule.",
    );
  }
  const confirmed = versions.find((candidate) => candidate.status === "CONFIRMED");
  if (confirmed && confirmed.id !== version?.id) {
    return blocked(
      "Already decided",
      `Version ${confirmed.versionNo} confirmed`,
      "Generate new candidates to confirm a different version.",
    );
  }
  return getConfirmationGatePresentation(version);
}
