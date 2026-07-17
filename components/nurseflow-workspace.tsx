"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminSession } from "@/lib/auth/types";
import {
  getConfirmationEligibility,
  getConfirmationGatePresentation,
  parseConfirmationSuccess,
} from "@/lib/confirmation-eligibility";
import { SHIFT_LABELS, WORKFLOW_STEPS } from "@/lib/constants";
import {
  constraintModeForNormalizedType,
  requestPolicyLabel,
} from "@/lib/request-semantics";
import { assignmentsForNormalizationCandidate } from "@/lib/normalization-candidate";
import type {
  GenerateScheduleResponse,
  RequestOutcome,
  ScheduleDataset,
  ScheduleVersion,
  WorkflowStep,
} from "@/lib/types";
import { formatDateTime, formatPercent, getDates } from "@/lib/utils";

import { createDemoResponse } from "@/components/demo-data";
import {
  ScheduleMatrix,
  type DateWindow,
  type SelectedAssignment,
} from "@/components/schedule-matrix";
import { SignOutButton } from "@/components/sign-out-button";

type BusyAction = "load" | "generate" | "explain" | "confirm" | "export" | null;
type ConnectionMode = "loading" | "live" | "demo" | "offline" | "error";

interface PersistedHistoryVersion {
  id: string;
  version_no: number;
  name: string;
  status: string;
  solver_status: string;
  confirmed_at: string | null;
  confirmed_by_nickname: string | null;
}

const DATE_WINDOWS: Array<{ id: DateWindow; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week-1", label: "1-7" },
  { id: "week-2", label: "8-14" },
  { id: "week-3", label: "15-21" },
  { id: "week-4", label: "22-28" },
  { id: "week-5", label: "29-31" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractGenerateResponse(value: unknown): GenerateScheduleResponse | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.data) ? value.data : value;
  if (
    !isRecord(candidate.dataset) ||
    !Array.isArray(candidate.versions) ||
    (candidate.mode !== "solver" && candidate.mode !== "demo")
  ) {
    return null;
  }
  return candidate as unknown as GenerateScheduleResponse;
}

function extractExplanation(value: unknown) {
  if (!isRecord(value)) return null;
  if (typeof value.explanation === "string") return value.explanation;
  if (isRecord(value.data) && typeof value.data.explanation === "string") {
    return value.data.explanation;
  }
  return null;
}

function extractImportedDataset(value: unknown): ScheduleDataset | null {
  if (!isRecord(value) || !isRecord(value.dataset)) return null;
  const dataset = value.dataset;
  if (
    !isRecord(dataset.period) ||
    !Array.isArray(dataset.nurses) ||
    !Array.isArray(dataset.requests) ||
    !Array.isArray(dataset.previousAssignments) ||
    dataset.privacyMode !== "NICKNAME_ONLY"
  ) {
    return null;
  }
  return dataset as unknown as ScheduleDataset;
}

function extractPersistedHistory(value: unknown): PersistedHistoryVersion[] {
  if (!isRecord(value) || value.persistenceMode !== "SUPABASE" || !Array.isArray(value.versions)) {
    return [];
  }
  return value.versions.flatMap((version) => {
    if (
      !isRecord(version) ||
      typeof version.id !== "string" ||
      typeof version.version_no !== "number" ||
      typeof version.name !== "string" ||
      typeof version.status !== "string" ||
      typeof version.solver_status !== "string"
    ) {
      return [];
    }
    return [{
      id: version.id,
      version_no: version.version_no,
      name: version.name,
      status: version.status,
      solver_status: version.solver_status,
      confirmed_at: typeof version.confirmed_at === "string" ? version.confirmed_at : null,
      confirmed_by_nickname:
        typeof version.confirmed_by_nickname === "string"
          ? version.confirmed_by_nickname
          : null,
    }];
  });
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as unknown;
  return isRecord(body) && typeof body.message === "string" ? body.message : fallback;
}

async function adminFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("The admin session has expired.");
  }
  return response;
}

async function enrichAmbiguousRequests(dataset: ScheduleDataset) {
  const ambiguous = dataset.requests.filter((request) => request.requiresReview);
  if (!ambiguous.length) return { dataset, provider: "deterministic" };

  const chunks: typeof ambiguous[] = [];
  for (let index = 0; index < ambiguous.length; index += 100) {
    chunks.push(ambiguous.slice(index, index + 100));
  }
  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const result = await adminFetch("/api/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: dataset.period.id,
          items: chunk.map((request) => ({
            id: `${request.nurseId}:${request.date}`,
            rawValue: request.rawValue,
          })),
        }),
      });
      if (!result.ok) {
        throw new Error(await responseError(result, "AI normalization is unavailable."));
      }
      const payload = (await result.json()) as unknown;
      if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
        throw new Error("Normalization endpoint returned an unexpected shape.");
      }
      return payload.candidates;
    }),
  );
  const candidates = new Map(
    responses.flat().filter(isRecord).map((candidate) => [candidate.id, candidate]),
  );
  const skillByNurseId = new Map(
    dataset.nurses.map((nurse) => [nurse.id, nurse.skillLevel]),
  );
  const requests = dataset.requests.map((request) => {
    const candidate = candidates.get(`${request.nurseId}:${request.date}`);
    if (!candidate) return request;
    const allowedAssignments = assignmentsForNormalizationCandidate(
      candidate,
      request.allowedAssignments,
    );
    const priority =
      typeof candidate.priority === "number" && candidate.priority >= 1 && candidate.priority <= 4
        ? (candidate.priority as 1 | 2 | 3 | 4)
        : request.priority;
    const candidateType = candidate.normalizedType;
    const normalizedType =
      candidateType === "VACATION" || candidateType === "EDUCATION"
        ? candidateType
        : request.normalizedType;
    const skillLevel = skillByNurseId.get(request.nurseId);
    return {
      ...request,
      normalizedType,
      allowedAssignments,
      priority,
      constraintMode: skillLevel
        ? constraintModeForNormalizedType(
            normalizedType,
            skillLevel,
            request.constraintMode,
          )
        : request.constraintMode,
      confidence:
        typeof candidate.confidence === "number" ? candidate.confidence : request.confidence,
      requiresReview: true,
    };
  });
  const usedOpenAI = responses.flat().some(
    (candidate) => isRecord(candidate) && candidate.provider === "openai",
  );
  return {
    dataset: { ...dataset, requests },
    provider: usedOpenAI ? "openai" : "deterministic",
  };
}

function preferredVersion(response: GenerateScheduleResponse) {
  const trustedVersions = response.versions.filter(
    (version) => getConfirmationGatePresentation(version).state !== "BLOCKED",
  );
  return (
    trustedVersions.find((version) => version.versionNo === 2) ??
    trustedVersions[0] ??
    response.versions.find((version) => version.versionNo === 2) ??
    response.versions[0]
  );
}

function initialSelection(response: GenerateScheduleResponse): SelectedAssignment | undefined {
  const version = preferredVersion(response);
  if (!version) return undefined;
  const outcome =
    version.requestOutcomes.find((item) => !item.satisfied) ?? version.requestOutcomes[0];
  if (!outcome) return undefined;
  const nurse = response.dataset.nurses.find((item) => item.id === outcome.nurseId);
  if (!nurse) return undefined;
  return { nurse, date: outcome.date, shift: outcome.assigned };
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function getOutcome(
  version: ScheduleVersion,
  selected: SelectedAssignment | undefined,
): RequestOutcome | undefined {
  if (!selected) return undefined;
  return version.requestOutcomes.find(
    (outcome) => outcome.nurseId === selected.nurse.id && outcome.date === selected.date,
  );
}

export function NurseFlowWorkspace({ admin }: { admin: AdminSession }) {
  const initialResponse = useMemo(() => createDemoResponse(), []);
  const [response, setResponse] = useState<GenerateScheduleResponse>(initialResponse);
  const [stagedDataset, setStagedDataset] = useState<ScheduleDataset | null>(null);
  const [activeVersionId, setActiveVersionId] = useState(
    () => preferredVersion(initialResponse)?.id ?? initialResponse.versions[0]?.id,
  );
  const [activeStep, setActiveStep] = useState<WorkflowStep>("generate");
  const [selected, setSelected] = useState<SelectedAssignment | undefined>(() =>
    initialSelection(initialResponse),
  );
  const [dateWindow, setDateWindow] = useState<DateWindow>("month");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("loading");
  const [networkOnline, setNetworkOnline] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState(
    "Synthetic nickname-only data is ready while the live services connect.",
  );
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resolvedReviewCount, setResolvedReviewCount] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [persistedVersions, setPersistedVersions] = useState<PersistedHistoryVersion[]>([]);

  const activeVersion =
    response.versions.find((version) => version.id === activeVersionId) ?? response.versions[0];
  const baselineVersion = response.versions[0];
  const workingDataset = stagedDataset ?? response.dataset;
  const hasPendingDataset = stagedDataset !== null;
  const reviewRequests = workingDataset.requests.filter((request) => request.requiresReview);
  const lockedRequests = workingDataset.requests.filter(
    (request) => request.constraintMode === "LOCKED",
  );
  const requiredChoices = workingDataset.requests.filter(
    (request) => request.constraintMode === "REQUIRED",
  );
  const softRequests = workingDataset.requests.filter(
    (request) =>
      request.constraintMode === "PREFERENCE" && request.normalizedType !== "AVAILABLE",
  );
  const activeStepIndex = WORKFLOW_STEPS.findIndex((step) => step.id === activeStep);
  const selectedOutcome = activeVersion ? getOutcome(activeVersion, selected) : undefined;
  const rejectedOutcomes =
    activeVersion?.requestOutcomes.filter(
      (outcome) => outcome.constraintMode === "PREFERENCE" && !outcome.satisfied,
    ) ?? [];
  const isDemoSnapshot = activeVersion?.solverStatus === "DEMO";
  const confirmationEligibility = getConfirmationEligibility(activeVersion);
  const confirmationGate = getConfirmationGatePresentation(activeVersion);
  const displayedConfirmationGate = hasPendingDataset
    ? {
        state: "BLOCKED" as const,
        className: "is-blocked" as const,
        label: "Blocked" as const,
        summary: "Generate imported requests first",
        description:
          "This imported request dataset has not been optimized. Generate and validate new candidates before confirmation.",
        disabledReason:
          "Generate candidates from the imported request data before choosing, confirming, or exporting a version.",
      }
    : confirmationGate;
  const hasTrustedSchedule = !hasPendingDataset && confirmationGate.state !== "BLOCKED";
  const canConfirmActiveVersion = !hasPendingDataset && confirmationEligibility.eligible;
  const selectedVersionBlockReason = displayedConfirmationGate.disabledReason;
  const displayedValidations = hasPendingDataset ? [] : confirmationEligibility.validations;
  const firstBlockingDetail = displayedValidations.find(
    (validation) => validation.status === "FAIL" && validation.details.length > 0,
  )?.details[0];
  const trustedVersionCount = hasPendingDataset
    ? 0
    : response.versions.filter(
        (version) => getConfirmationGatePresentation(version).state !== "BLOCKED",
      ).length;
  const isSyntheticDataset =
    workingDataset.nurses.length > 0 &&
    workingDataset.nurses.every((nurse) => nurse.synthetic === true);
  const hardRuleStateLabel = hasPendingDataset
    ? "Awaiting generation"
    : confirmationGate.state === "CONFIRMED"
    ? "Confirmed"
    : confirmationEligibility.eligible
      ? isDemoSnapshot
        ? "Reference snapshot"
        : "Independent pass"
      : "Confirmation blocked";

  const nurseById = useMemo(
    () => new Map(response.dataset.nurses.map((nurse) => [nurse.id, nurse])),
    [response.dataset.nurses],
  );
  const reviewNurseById = useMemo(
    () => new Map(workingDataset.nurses.map((nurse) => [nurse.id, nurse])),
    [workingDataset.nurses],
  );

  const applyResponse = useCallback(
    (next: GenerateScheduleResponse, acceptedReviewCount = 0) => {
      setResponse(next);
      setStagedDataset(null);
      const nextVersion = preferredVersion(next);
      setActiveVersionId(nextVersion?.id ?? next.versions[0]?.id);
      setSelected(initialSelection(next));
      setExplanation("");
      setResolvedReviewCount(acceptedReviewCount);
    },
    [],
  );

  const refreshPersistedHistory = useCallback(async (periodId: string) => {
    const result = await adminFetch(`/api/history?periodId=${encodeURIComponent(periodId)}`, {
      cache: "no-store",
    });
    if (!result.ok) {
      throw new Error(await responseError(result, "Unable to load confirmed history."));
    }
    const versions = extractPersistedHistory(await result.json());
    setPersistedVersions(versions);
    return versions;
  }, []);

  const loadDemo = useCallback(async () => {
    setBusyAction("load");
    setConnectionMode("loading");
    try {
      const result = await adminFetch("/api/demo", { method: "POST", cache: "no-store" });
      if (!result.ok) throw new Error(`Demo endpoint returned ${result.status}.`);
      const parsed = extractGenerateResponse(await result.json());
      if (!parsed) throw new Error("Demo endpoint returned an unexpected shape.");
      applyResponse(parsed);
      setConnectionMode(parsed.mode === "solver" ? "live" : "demo");
      let historyNotice = "";
      try {
        const history = await refreshPersistedHistory(parsed.dataset.period.id);
        if (history.some((version) => version.status === "CONFIRMED")) {
          historyNotice = " A confirmed Supabase version is available in the archive.";
        }
      } catch (error) {
        historyNotice = ` Confirmed history could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`;
      }
      setNotice(
        (parsed.message ??
          (parsed.mode === "demo"
            ? "A precomputed showcase snapshot is loaded. Run Generate to request fresh solver output."
            : "Live schedule data loaded successfully.")) + historyNotice,
      );
    } catch {
      const fallback = createDemoResponse();
      applyResponse(fallback);
      setConnectionMode(navigator.onLine ? "demo" : "offline");
      setNotice(
        navigator.onLine
          ? "Live demo endpoint is unavailable. The complete local showcase dataset is active."
          : "You are offline. The complete local showcase dataset remains available.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [applyResponse, refreshPersistedHistory]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDemo(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDemo]);

  useEffect(() => {
    const updateNetworkState = () => setNetworkOnline(navigator.onLine);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  if (!activeVersion) {
    return (
      <main className="fatal-state">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>No schedule version could be loaded.</h1>
        <button className="button button--primary" type="button" onClick={() => void loadDemo()}>
          Load showcase data
        </button>
      </main>
    );
  }

  const selectVersion = (version: ScheduleVersion) => {
    setActiveVersionId(version.id);
    setActiveStep("compare");
    setExplanation("");
    if (selected) {
      const assignment = version.assignments.find(
        (item) => item.nurseId === selected.nurse.id && item.date === selected.date,
      );
      if (assignment) setSelected({ ...selected, shift: assignment.shift });
    }
  };

  const selectOutcome = (outcome: RequestOutcome) => {
    const nurse = nurseById.get(outcome.nurseId);
    if (!nurse) return;
    setSelected({ nurse, date: outcome.date, shift: outcome.assigned });
    setExplanation(outcome.explanation ?? "");
  };

  const selectAssignment = (assignment: SelectedAssignment) => {
    setSelected(assignment);
    setExplanation("");
  };

  const handleImportContinue = async () => {
    if (!selectedFile && !sheetUrl.trim()) {
      setStagedDataset(null);
      setResolvedReviewCount(0);
      setActiveStep("review");
      setNotice("Using the synthetic nickname-only request set for this showcase.");
      return;
    }

    setBusyAction("load");
    setNotice("Importing the request sheet and enforcing nickname-only privacy checks...");
    try {
      const period = { ...response.dataset.period, status: "DRAFT" as const };
      let result: Response;
      if (selectedFile) {
        const form = new FormData();
        form.set("file", selectedFile);
        form.set("period", JSON.stringify(period));
        result = await adminFetch("/api/import", { method: "POST", body: form });
      } else {
        result = await adminFetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleSheetUrl: sheetUrl.trim(), period }),
        });
      }
      if (!result.ok) throw new Error(await responseError(result, "Import failed."));
      const imported = extractImportedDataset(await result.json());
      if (!imported) throw new Error("Import endpoint returned an unexpected shape.");

      let normalized = { dataset: imported, provider: "deterministic" };
      let normalizationWarning = "";
      try {
        normalized = await enrichAmbiguousRequests(imported);
      } catch (error) {
        normalizationWarning = ` AI suggestions were unavailable (${error instanceof Error ? error.message : "unknown error"}); deterministic suggestions remain visible.`;
      }
      setStagedDataset(normalized.dataset);
      setResolvedReviewCount(0);
      setActiveStep("review");
      setConnectionMode("live");
      const lockedCount = normalized.dataset.requests.filter(
        (request) => request.constraintMode === "LOCKED",
      ).length;
      const requiredCount = normalized.dataset.requests.filter(
        (request) => request.constraintMode === "REQUIRED",
      ).length;
      setNotice(
        `${normalized.dataset.nurses.length} nickname-only records imported. ${lockedCount} fixed VAC/ED events and ${requiredCount} required choices were identified. ${normalized.dataset.requests.filter((request) => request.requiresReview).length} values require review${normalized.provider === "openai" ? " with OpenAI suggestions" : ""}.${normalizationWarning}`,
      );
    } catch (error) {
      setConnectionMode("error");
      setNotice(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveAll = () => {
    setResolvedReviewCount(reviewRequests.length);
    setActiveStep("generate");
    setNotice(
      `${reviewRequests.length} ambiguous values resolved. ${lockedRequests.length} fixed events and ${requiredChoices.length} required choices will be enforced during optimization.`,
    );
  };

  const handleGenerate = async () => {
    if (reviewRequests.length > resolvedReviewCount) {
      setActiveStep("review");
      setNotice(
        `Review and accept all ${reviewRequests.length} ambiguous values before optimization.`,
      );
      return;
    }
    setBusyAction("generate");
    setActiveStep("generate");
    setNotice("Building candidate schedules and independently checking every hard rule...");
    try {
      const result = await adminFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset: workingDataset }),
      });
      if (!result.ok) {
        throw new Error(
          await responseError(result, `Generate endpoint returned ${result.status}.`),
        );
      }
      const parsed = extractGenerateResponse(await result.json());
      if (!parsed) throw new Error("Generate endpoint returned an unexpected shape.");
      applyResponse(parsed, reviewRequests.length);
      setConnectionMode(parsed.mode === "solver" ? "live" : "demo");
      const trustedCount = parsed.versions.filter(
        (version) => getConfirmationGatePresentation(version).state !== "BLOCKED",
      ).length;
      setNotice(
        parsed.mode === "solver"
          ? trustedCount > 0
            ? `Optimization complete. ${trustedCount} of ${parsed.versions.length} candidate schedules passed every hard rule and are ready for admin review. Fixed VAC/ED events and required choices are mandatory; unmet soft requests remain visible.`
            : "Optimization finished, but no safe roster was produced. Soft requests may be unmet, but fixed VAC/ED events, required choices, staffing, and safety rules must pass before a version can be chosen."
          : "A precomputed showcase response was loaded. It is labelled DEMO until fresh solver output is available.",
      );
    } catch (error) {
      setConnectionMode(networkOnline ? "error" : "offline");
      setNotice(
        error instanceof Error
          ? `${error.message} The previous schedule view remains on screen and must be rechecked before use.`
          : "Optimization failed. The previous schedule view remains on screen and must be rechecked before use.",
      );
    } finally {
      setBusyAction(null);
      setActiveStep("compare");
    }
  };

  const handleExplain = async () => {
    if (!selectedOutcome) {
      setNotice("Select an unfulfilled request to inspect its scheduling evidence.");
      return;
    }
    setBusyAction("explain");
    setExplanation(selectedOutcome.explanation ?? "Reviewing the structured schedule evidence...");
    try {
      const result = await adminFetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: response.dataset.period.id,
          nurseNickname: selected?.nurse.nickname ?? "Nickname",
          date: selectedOutcome.date,
          requested: selectedOutcome.requested,
          assigned: selectedOutcome.assigned,
          reasonCode: selectedOutcome.reasonCode ?? "SCHEDULE_REQUIREMENTS",
          facts: [
            `${activeVersion.metrics.hardConstraintsPassed} of ${activeVersion.metrics.hardConstraintsTotal} hard constraints passed.`,
            `The selected version preserves ${formatPercent(activeVersion.metrics.offSatisfactionRate)} of OFF requests.`,
            `Member L0 is used for ${activeVersion.metrics.memberL0Usage} clinical shifts.`,
          ],
        }),
      });
      if (!result.ok) throw new Error(`Explain endpoint returned ${result.status}.`);
      const nextExplanation = extractExplanation(await result.json());
      if (nextExplanation) setExplanation(nextExplanation);
      setNotice("Explanation grounded in the selected version and validation evidence.");
    } catch {
      setNotice("AI explanation is offline. The deterministic reason from the solver remains visible.");
    } finally {
      setBusyAction(null);
    }
  };

  const markConfirmedLocally = () => {
    const confirmedAt = new Date().toISOString();
    setResponse((current) => ({
      ...current,
      dataset: {
        ...current.dataset,
        period: { ...current.dataset.period, status: "CONFIRMED" },
      },
      versions: current.versions.map((version) =>
        version.id === activeVersion.id
          ? {
              ...version,
              status: "CONFIRMED",
              confirmedAt,
              confirmedByNickname: admin.displayName,
            }
          : version,
      ),
    }));
  };

  const handleConfirm = async () => {
    if (!canConfirmActiveVersion) {
      setConnectionMode("error");
      setNotice(
        hasPendingDataset
          ? "Generate candidates from the imported request data before confirmation."
          : confirmationEligibility.message,
      );
      setActiveStep("confirm");
      return;
    }
    setBusyAction("confirm");
    try {
      const result = await adminFetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: response.dataset.period.id,
          versionId: activeVersion.id,
        }),
      });
      if (!result.ok) {
        throw new Error(await responseError(result, "The schedule could not be confirmed."));
      }
      const confirmation = parseConfirmationSuccess(await result.json(), activeVersion.id);
      if (!confirmation) {
        throw new Error("The confirmation endpoint returned an invalid success response.");
      }
      markConfirmedLocally();
      let archiveWarning = "";
      if (confirmation.persisted) {
        try {
          await refreshPersistedHistory(response.dataset.period.id);
        } catch (error) {
          archiveWarning = ` The version is confirmed, but archive refresh failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
      setConnectionMode(confirmation.persisted ? "live" : "demo");
      setNotice(
        (confirmation.message ??
          `Version ${activeVersion.versionNo} is confirmed and ready to export.`) + archiveWarning,
      );
    } catch (error) {
      setConnectionMode("error");
      setNotice(error instanceof Error ? error.message : "The schedule could not be confirmed.");
    } finally {
      setBusyAction(null);
      setActiveStep("confirm");
    }
  };

  const handleExport = async () => {
    if (!hasTrustedSchedule) {
      setConnectionMode("error");
      setNotice(
        "Export is blocked because this version does not have complete, passing hard-rule evidence.",
      );
      return;
    }
    setBusyAction("export");
    try {
      const result = await adminFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: response.dataset.period.id,
          versionId: activeVersion.id,
        }),
      });
      if (!result.ok) {
        throw new Error(await responseError(result, "The selected schedule could not be exported."));
      }
      const blob = await result.blob();
      downloadBlob(blob, `nurseflow-${response.dataset.period.code}-v${activeVersion.versionNo}.xlsx`);
      setNotice("Excel export created from the selected schedule version.");
    } catch (error) {
      setConnectionMode("error");
      setNotice(error instanceof Error ? error.message : "The selected schedule could not be exported.");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePersistedExport = async (version: PersistedHistoryVersion) => {
    setBusyAction("export");
    try {
      const result = await adminFetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId: response.dataset.period.id,
          versionId: version.id,
        }),
      });
      if (!result.ok) {
        throw new Error(await responseError(result, "Persisted export failed."));
      }
      downloadBlob(
        await result.blob(),
        `nurseflow-${response.dataset.period.code}-archive-v${version.version_no}.xlsx`,
      );
      setNotice(`Confirmed archive version ${version.version_no} exported from Supabase.`);
    } catch (error) {
      setConnectionMode("error");
      setNotice(error instanceof Error ? error.message : "Persisted export failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const connectionLabel = !networkOnline
    ? "Offline"
    : connectionMode === "live"
      ? "Live solver"
      : connectionMode === "loading"
        ? "Connecting"
      : connectionMode === "error"
          ? "Action needed"
          : "Precomputed snapshot";

  return (
    <main className="workspace-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>NurseFlow AI</strong>
            <span>Clinical schedule workspace</span>
          </div>
        </div>

        <div className="period-heading">
          <p>{response.dataset.period.departmentCode} / August 2026</p>
          <h1>{response.dataset.period.name}</h1>
        </div>

        <div className="header-actions">
          <span className="privacy-badge">
            <i aria-hidden="true" /> {isSyntheticDataset ? "Nickname-only synthetic data" : "Nickname-only request data"}
          </span>
          <span className="admin-identity" aria-label={`Signed in as ${admin.displayName}, admin`}>
            <i aria-hidden="true">A</i>
            <span>
              <b>{admin.displayName}</b>
              <small>ADMIN</small>
            </span>
          </span>
          <button
            className="button button--ghost"
            type="button"
            disabled={busyAction === "export" || !hasTrustedSchedule}
            title={hasTrustedSchedule ? undefined : "Export requires a safe version with passing hard-rule evidence."}
            onClick={() => void handleExport()}
          >
            {busyAction === "export" ? "Preparing..." : "Export"}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={busyAction === "confirm" || !canConfirmActiveVersion}
            title={canConfirmActiveVersion ? undefined : selectedVersionBlockReason}
            onClick={() => void handleConfirm()}
          >
            {activeVersion.status === "CONFIRMED"
              ? `Version ${activeVersion.versionNo} confirmed`
              : busyAction === "confirm"
                ? "Confirming..."
                : `Confirm v${activeVersion.versionNo}`}
          </button>
          <SignOutButton onError={setNotice} />
        </div>
      </header>

      <div
        className={`status-line status-line--${connectionMode}`}
        role="status"
        aria-live="polite"
      >
        <span className="connection-state">
          <i aria-hidden="true" /> {connectionLabel}
        </span>
        <p>{notice}</p>
        <button type="button" onClick={() => setNotice("")} aria-label="Dismiss status message">
          Dismiss
        </button>
      </div>

      <nav className="workflow-rail" aria-label="Scheduling workflow">
        {WORKFLOW_STEPS.map((step, index) => {
          const isActive = step.id === activeStep;
          const isComplete =
            index < activeStepIndex ||
            (!hasPendingDataset && activeVersion.status === "CONFIRMED");
          return (
            <button
              className={`${isActive ? "is-active" : ""}${isComplete ? " is-complete" : ""}`}
              type="button"
              key={step.id}
              aria-current={isActive ? "step" : undefined}
              onClick={() => setActiveStep(step.id)}
            >
              <span>{isComplete ? "Done" : String(index + 1).padStart(2, "0")}</span>
              <strong>{step.label}</strong>
              <small>{step.hint}</small>
            </button>
          );
        })}
      </nav>

      <section className="action-dock" aria-labelledby="action-dock-title">
        {activeStep === "import" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">01 / Import</p>
              <h2 id="action-dock-title">Bring in the request sheet</h2>
              <p>Only nicknames and scheduling values continue into this workspace.</p>
            </div>
            <div className="import-controls">
              <label>
                <span>Google Sheet URL</span>
                <input
                  type="url"
                  value={sheetUrl}
                  placeholder="https://docs.google.com/spreadsheets/..."
                  onChange={(event) => setSheetUrl(event.target.value)}
                />
              </label>
              <label className="file-control">
                <span>{fileName || "Choose Excel"}</span>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    setFileName(file?.name ?? "");
                  }}
                />
              </label>
              <button
                className="button button--primary"
                type="button"
                disabled={busyAction === "load"}
                onClick={() => void handleImportContinue()}
              >
                {busyAction === "load" ? "Importing..." : "Review source"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busyAction === "load"}
                onClick={() => void loadDemo()}
              >
                {busyAction === "load" ? "Loading..." : "Reload synthetic demo"}
              </button>
            </div>
          </>
        ) : null}

        {activeStep === "review" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">02 / Review</p>
              <h2 id="action-dock-title">Resolve {reviewRequests.length} ambiguous values</h2>
              <p>Confirm token meanings before optimization. Mandatory events and choices cannot be traded away.</p>
            </div>
            <div className="review-stack">
              <div className="request-policy-summary" aria-label="Imported request policy summary">
                <span><strong>{lockedRequests.length}</strong><small>Fixed VAC / ED</small></span>
                <span><strong>{requiredChoices.length}</strong><small>Required O/D or O/N</small></span>
                <span><strong>{softRequests.length}</strong><small>Soft requests</small></span>
              </div>
              {reviewRequests.length ? (
                <div className="review-preview">
                  {reviewRequests.map((request) => (
                    <div key={`${request.nurseId}:${request.date}`}>
                      <span>{reviewNurseById.get(request.nurseId)?.nickname ?? "Nickname"}</span>
                      <strong>{request.rawValue}</strong>
                      <small>
                        {Math.round(request.confidence * 100)}% confidence | {request.allowedAssignments.join(" / ")} | {requestPolicyLabel(request.constraintMode)}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="review-clear">All request values use the approved vocabulary.</p>
              )}
            </div>
            <button className="button button--primary" type="button" onClick={handleResolveAll}>
              {reviewRequests.length === 0
                ? "Continue to generate"
                : resolvedReviewCount === reviewRequests.length
                  ? "Mappings accepted"
                  : "Accept suggestions"}
            </button>
          </>
        ) : null}

        {activeStep === "generate" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">03 / Generate</p>
              <h2 id="action-dock-title">Build safe candidate schedules</h2>
              <p>{workingDataset.nurses.length * getDates(workingDataset.period.startDate, workingDataset.period.endDate).length} assignments are optimized, then checked again by an independent validator.</p>
            </div>
            <div className="generation-proof" aria-label="Generation scope">
              <span><strong>{workingDataset.nurses.length}</strong> nicknames</span>
              <span><strong>{getDates(workingDataset.period.startDate, workingDataset.period.endDate).length}</strong> days</span>
              <span><strong>{activeVersion.metrics.hardConstraintsTotal}</strong> hard rules</span>
            </div>
            <button
              className="button button--primary button--large"
              type="button"
              disabled={busyAction === "generate"}
              onClick={() => void handleGenerate()}
            >
              {busyAction === "generate" ? <><i className="busy-dot" /> Optimizing...</> : "Generate candidates"}
            </button>
          </>
        ) : null}

        {activeStep === "compare" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">04 / Compare</p>
              <h2 id="action-dock-title">Version {activeVersion.versionNo}: {activeVersion.name}</h2>
              <p>
                {hasTrustedSchedule
                  ? "Compare soft-request satisfaction and workload trade-offs. Fixed VAC/ED events and required choices already passed as mandatory evidence."
                  : "This result cannot be used as a roster. Review the failed or missing hard-rule evidence, adjust the inputs, and generate again."}
              </p>
            </div>
            <div className={`compare-callout${firstBlockingDetail ? " is-conflict" : ""}`}>
              <strong>
                {hasTrustedSchedule
                  ? formatPercent(activeVersion.metrics.requestSatisfactionRate)
                  : firstBlockingDetail
                    ? "Action required"
                    : "—"}
              </strong>
              <span>
                {hasTrustedSchedule
                  ? "Soft requests fulfilled"
                  : firstBlockingDetail ?? "Request metrics unavailable"}
              </span>
            </div>
            <button
              className="button button--primary"
              type="button"
              disabled={!canConfirmActiveVersion}
              title={canConfirmActiveVersion ? undefined : selectedVersionBlockReason}
              onClick={() => setActiveStep("confirm")}
            >
              {canConfirmActiveVersion
                ? `Choose version ${activeVersion.versionNo}`
                : hasPendingDataset
                  ? "Generate imported requests first"
                : activeVersion.status === "CONFIRMED"
                  ? `Version ${activeVersion.versionNo} confirmed`
                  : `Version ${activeVersion.versionNo} blocked`}
            </button>
          </>
        ) : null}

        {activeStep === "confirm" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">05 / Confirm</p>
              <h2 id="action-dock-title">Lock the selected decision</h2>
              <p>{displayedConfirmationGate.description}</p>
            </div>
            <div className={`confirmation-gate ${displayedConfirmationGate.className}`}>
              <span>{displayedConfirmationGate.label}</span>
              <strong>{displayedConfirmationGate.summary}</strong>
            </div>
            <div className="dock-actions">
              <button
                className="button button--primary"
                type="button"
                disabled={busyAction === "confirm" || !canConfirmActiveVersion}
                title={canConfirmActiveVersion ? undefined : selectedVersionBlockReason}
                onClick={() => void handleConfirm()}
              >
                {activeVersion.status === "CONFIRMED" ? "Confirmed" : "Confirm schedule"}
              </button>
              <button
                className="button button--ghost"
                type="button"
                disabled={busyAction === "export" || !hasTrustedSchedule}
                title={hasTrustedSchedule ? undefined : "Export requires a safe version with passing hard-rule evidence."}
                onClick={() => void handleExport()}
              >
                Export selected
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section className="metric-band" aria-label="Selected version metrics">
        <div>
          <span>Coverage</span>
          <strong>{hasTrustedSchedule ? "10D / 9N" : "—"}</strong>
          <small>{hasTrustedSchedule ? "Every day" : "Not validated"}</small>
        </div>
        <div>
          <span>Hard rules</span>
          <strong>
            {hasPendingDataset
              ? "—"
              : confirmationEligibility.hardTotal > 0
              ? `${confirmationEligibility.hardPassed}/${confirmationEligibility.hardTotal}`
              : "No evidence"}
          </strong>
          <small>{hardRuleStateLabel}</small>
        </div>
        <div>
          <span>Soft requests met</span>
          <strong>{hasTrustedSchedule ? formatPercent(activeVersion.metrics.requestSatisfactionRate) : "—"}</strong>
          <small>{hasTrustedSchedule ? `OFF ${formatPercent(activeVersion.metrics.offSatisfactionRate)} · O1 ${formatPercent(activeVersion.metrics.o1SatisfactionRate)}` : "Unavailable"}</small>
        </div>
        <div>
          <span>Balance</span>
          <strong>{hasTrustedSchedule ? formatPercent((activeVersion.metrics.dayBalanceScore + activeVersion.metrics.nightBalanceScore) / 2) : "—"}</strong>
          <small>{hasTrustedSchedule ? "Day and Night" : "Unavailable"}</small>
        </div>
        <div>
          <span>Member L0</span>
          <strong>{hasTrustedSchedule ? activeVersion.metrics.memberL0Usage : "—"}</strong>
          <small>{hasTrustedSchedule ? "Clinical shifts" : "Unavailable"}</small>
        </div>
        <div>
          <span>Mandatory inputs</span>
          <strong>
            {hasPendingDataset
              ? `${lockedRequests.length} fixed`
              : hasTrustedSchedule
                ? activeVersion.metrics.lockedRequirementsTotal
                  ? `${activeVersion.metrics.lockedRequirementsPassed}/${activeVersion.metrics.lockedRequirementsTotal} fixed`
                  : "No fixed events"
                : "—"}
          </strong>
          <small>
            {hasPendingDataset
              ? `${requiredChoices.length} required choices · awaiting generation`
              : hasTrustedSchedule
                ? activeVersion.metrics.requiredChoicesTotal
                  ? `${activeVersion.metrics.requiredChoicesPassed}/${activeVersion.metrics.requiredChoicesTotal} required choices`
                  : "No required choices"
                : "Unavailable"}
          </small>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="schedule-surface">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">Decision surface</p>
              <div className="surface-title-line">
                <h2>August roster</h2>
                {isDemoSnapshot && !hasPendingDataset ? <span>Precomputed / DEMO</span> : null}
                {!hasTrustedSchedule ? <span>Preview withheld</span> : null}
              </div>
              <p>
                {hasTrustedSchedule
                  ? "Click any assignment for context. A dot marks changes from version 1."
                  : "The assignment grid is hidden because this result is not safe to use."}
              </p>
            </div>
            <div className="surface-tools">
              <div className="shift-legend" aria-label="Shift legend">
                {(["D", "N", "OFF", "VAC", "ED"] as const).map((shift) => (
                  <span key={shift}><i className={`legend-${shift.toLowerCase()}`} />{shift}</span>
                ))}
              </div>
              <div className="constraint-legend" aria-label="Request policy legend">
                <span><i className="constraint-key constraint-key--locked">F</i> Fixed VAC/ED</span>
                <span><i className="constraint-key constraint-key--required">R</i> Required choice</span>
              </div>
              <div className="date-window" aria-label="Visible schedule dates">
                {DATE_WINDOWS.map((window) => (
                  <button
                    type="button"
                    key={window.id}
                    aria-pressed={dateWindow === window.id}
                    onClick={() => setDateWindow(window.id)}
                  >
                    {window.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {hasTrustedSchedule ? (
            <ScheduleMatrix
              nurses={response.dataset.nurses}
              version={activeVersion}
              baselineVersion={baselineVersion}
              dateWindow={dateWindow}
              selected={selected}
              onSelect={selectAssignment}
            />
          ) : (
            <div className="schedule-scroller" role="status" aria-label="Roster preview unavailable">
              <div className="confirmation-gate is-blocked">
                <span>Roster preview withheld</span>
                <strong>
                  No assignments are shown until the solver returns a VALID version with complete,
                  passing hard-rule evidence.
                </strong>
              </div>
            </div>
          )}

          <footer className="surface-footer">
            <span>{workingDataset.sourceLabel}</span>
            <span>
              Context included: {formatShortDate(workingDataset.period.contextStartDate)}–
              {formatShortDate(workingDataset.period.contextEndDate)}
            </span>
            <span>
              {hasPendingDataset
                ? "Awaiting generation"
                : `${isDemoSnapshot ? "Snapshot" : "Generated"} ${formatDateTime(activeVersion.generatedAt)}`}
            </span>
          </footer>
        </div>

        <aside className="decision-rail" aria-label="Schedule evidence and validation">
          <section className="assignment-focus">
            <p className="eyebrow">Selected decision</p>
            {hasTrustedSchedule && selected ? (
              <>
                <div className="focus-heading">
                  <div>
                    <h2>{selected.nurse.nickname}</h2>
                    <p>{formatShortDate(selected.date)} / {selected.nurse.skillLevel.replaceAll("_", " ")}</p>
                  </div>
                  <span className={`focus-shift focus-shift--${selected.shift.toLowerCase()}`}>
                    {selected.shift}
                  </span>
                </div>

                {selectedOutcome ? (
                  <>
                    <div className={`request-policy-callout is-${selectedOutcome.constraintMode.toLowerCase()}`}>
                      <strong>{requestPolicyLabel(selectedOutcome.constraintMode)}</strong>
                      <span>
                        {selectedOutcome.constraintMode === "LOCKED"
                          ? "Approved VAC/ED must match exactly."
                          : selectedOutcome.constraintMode === "REQUIRED"
                            ? "The assignment must stay inside the allowed choice set."
                            : "May yield only after mandatory and safety rules."}
                      </span>
                    </div>
                    <div className="request-evidence">
                      <div>
                        <span>Requested</span>
                        <strong>{selectedOutcome.requested}</strong>
                      </div>
                      <div>
                        <span>Assigned</span>
                        <strong>{SHIFT_LABELS[selectedOutcome.assigned]}</strong>
                      </div>
                      <div>
                        <span>Priority</span>
                        <strong>{selectedOutcome.priority ?? "-"}</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="muted-copy">No exception is attached to this assignment.</p>
                )}

                <div className="explanation-copy" aria-live="polite">
                  <span>{selectedOutcome?.reasonCode?.replaceAll("_", " ") ?? "Assignment detail"}</span>
                  <p>{explanation || selectedOutcome?.explanation || "Select an unfulfilled request below to see its scheduling evidence."}</p>
                </div>

                <button
                  className="text-button text-button--accent"
                  type="button"
                  disabled={
                    !selectedOutcome ||
                    selectedOutcome.satisfied ||
                    selectedOutcome.constraintMode !== "PREFERENCE" ||
                    busyAction === "explain"
                  }
                  onClick={() => void handleExplain()}
                >
                  {busyAction === "explain"
                    ? "Checking evidence..."
                    : selectedOutcome?.constraintMode !== "PREFERENCE"
                      ? "Mandatory evidence shown"
                      : selectedOutcome?.satisfied
                        ? "Soft request fulfilled"
                        : "Explain with AI evidence"}
                </button>
              </>
            ) : (
              <p className="muted-copy">
                {hasTrustedSchedule
                  ? "Choose an assignment in the roster."
                  : "No safe assignment is available for review in this version."}
              </p>
            )}
          </section>

          <section className="exception-list">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">Needs explanation</p>
                <h3>Unfulfilled soft requests</h3>
              </div>
              <span>{hasTrustedSchedule ? rejectedOutcomes.length : "—"}</span>
            </div>
            {!hasTrustedSchedule ? (
              <p className="muted-copy">
                Soft-request trade-offs are shown only after fixed events, required choices, staffing, and safety rules pass.
              </p>
            ) : rejectedOutcomes.length ? (
              rejectedOutcomes.map((outcome) => {
                const nurse = nurseById.get(outcome.nurseId);
                const isSelected =
                  selected?.nurse.id === outcome.nurseId && selected.date === outcome.date;
                return (
                  <button
                    type="button"
                    className={isSelected ? "is-selected" : ""}
                    key={`${outcome.nurseId}:${outcome.date}`}
                    onClick={() => selectOutcome(outcome)}
                  >
                    <span>
                      <strong>{nurse?.nickname ?? "Nickname"}</strong>
                      <small>{formatShortDate(outcome.date)} / {outcome.requested}</small>
                    </span>
                    <b>{outcome.assigned}</b>
                  </button>
                );
              })
            ) : (
              <p className="muted-copy">Every recorded request is satisfied.</p>
            )}
          </section>

          <section className="validation-list">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">{isDemoSnapshot ? "Reference snapshot" : "Independent check"}</p>
                <h3>Hard constraints</h3>
              </div>
              <span>{displayedConfirmationGate.summary}</span>
            </div>
            {displayedValidations.length ? (
              <ul>
                {displayedValidations.map((validation) => (
                  <li key={validation.code} className={`is-${validation.status.toLowerCase()}`}>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{validation.name}</strong>
                      {validation.status === "FAIL" && validation.details.length ? (
                        <span className="validation-detail">
                          {validation.details.slice(0, 3).map((detail) => (
                            <small key={detail}>{detail}</small>
                          ))}
                          {validation.details.length > 3 ? (
                            <small>+{validation.details.length - 3} more conflicts</small>
                          ) : null}
                        </span>
                      ) : (
                        <small>{validation.violationCount} violations</small>
                      )}
                    </span>
                    <b>{validation.status}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No valid validation evidence is available.</p>
            )}
          </section>
        </aside>
      </section>

      <section className="version-ledger" aria-labelledby="version-ledger-title">
        <div className="version-ledger-heading">
          <p className="eyebrow">Candidate comparison</p>
          <h2 id="version-ledger-title">
            {hasPendingDataset
              ? "Generate the imported request set"
              : trustedVersionCount > 0
                ? "Safe roster options, different trade-offs"
                : "No safe roster yet"}
          </h2>
          <p>
            {hasPendingDataset
              ? "The versions below belong to the previous dataset and cannot be chosen, confirmed, or exported. Generate new candidates after review."
              : trustedVersionCount > 0
              ? `${trustedVersionCount} of ${response.versions.length} candidates pass every hard rule. Fixed events and required choices are enforced; unmet soft requests stay visible for admin review.`
              : "None of the candidates passed every hard rule. Unmet soft requests can be accepted, but fixed events, required choices, staffing, and safety rules cannot; adjust the inputs and generate again."}
          </p>
        </div>
        <div className="version-rows">
          {response.versions.map((version) => {
            const isActive = version.id === activeVersion.id;
            const versionGate = getConfirmationGatePresentation(version);
            const isTrustedVersion = !hasPendingDataset && versionGate.state !== "BLOCKED";
            return (
              <button
                className={isActive ? "is-active" : ""}
                type="button"
                key={version.id}
                aria-pressed={isActive}
                onClick={() => selectVersion(version)}
              >
                <span className="version-number">V{version.versionNo}</span>
                <span className="version-name">
                  <strong>{version.name}</strong>
                  <small>
                    {hasPendingDataset
                      ? "Previous dataset / awaiting generation"
                      : `${version.status} / ${version.solverStatus} / ${versionGate.label}`}
                    {isTrustedVersion ? ` / score ${version.objectiveScore?.toLocaleString() ?? "-"}` : ""}
                  </small>
                </span>
                <span><small>Soft requests</small><strong>{isTrustedVersion ? formatPercent(version.metrics.requestSatisfactionRate) : "—"}</strong></span>
                <span><small>Day balance</small><strong>{isTrustedVersion ? formatPercent(version.metrics.dayBalanceScore) : "—"}</strong></span>
                <span><small>Night balance</small><strong>{isTrustedVersion ? formatPercent(version.metrics.nightBalanceScore) : "—"}</strong></span>
                <span><small>Member L0</small><strong>{isTrustedVersion ? version.metrics.memberL0Usage : "—"}</strong></span>
                <b>{isActive ? "Viewing" : isTrustedVersion ? "Compare" : "Inspect"}</b>
              </button>
            );
          })}
          {persistedVersions.some((version) => version.status === "CONFIRMED") ? (
            <div className="confirmed-archive">
              <div>
                <p className="eyebrow">Supabase archive</p>
                <strong>Confirmed history</strong>
              </div>
              {persistedVersions
                .filter((version) => version.status === "CONFIRMED")
                .map((version) => (
                  <article key={version.id}>
                    <span>
                      <strong>V{version.version_no} / {version.name}</strong>
                      <small>
                        {version.solver_status} | {version.confirmed_by_nickname ?? "Scheduler"} | {version.confirmed_at ? formatDateTime(version.confirmed_at) : "Confirmed"}
                      </small>
                    </span>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={busyAction === "export"}
                      onClick={() => void handlePersistedExport(version)}
                    >
                      Export archive
                    </button>
                  </article>
                ))}
            </div>
          ) : null}
        </div>
      </section>

      <footer className="app-footer">
        <div>
          <strong>NurseFlow AI</strong>
          <span>Decision support for nurse schedulers</span>
        </div>
        <p>
          {isSyntheticDataset
            ? "Showcase data uses synthetic nicknames only. Human approval remains required."
            : "Imported request data is limited to nicknames. Human approval remains required."}
        </p>
      </footer>
    </main>
  );
}
