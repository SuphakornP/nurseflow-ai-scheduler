"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminSession } from "@/lib/auth/types";
import {
  getConfirmationEligibility,
  getConfirmationGatePresentation,
  parseConfirmationSuccess,
} from "@/lib/confirmation-eligibility";
import { SHIFT_LABELS, WORKFLOW_STEPS } from "@/lib/constants";
import { csvCell } from "@/lib/spreadsheet";
import type {
  GenerateScheduleResponse,
  RequestOutcome,
  ScheduleDataset,
  ScheduleVersion,
  ShiftCode,
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
  const validShifts = new Set<ShiftCode>(["D", "N", "OFF", "VAC", "ED"]);
  const candidates = new Map(
    responses.flat().filter(isRecord).map((candidate) => [candidate.id, candidate]),
  );
  const requests = dataset.requests.map((request) => {
    const candidate = candidates.get(`${request.nurseId}:${request.date}`);
    if (!candidate) return request;
    const allowedAssignments = Array.isArray(candidate.allowedAssignments)
      ? candidate.allowedAssignments.filter(
          (shift): shift is ShiftCode =>
            typeof shift === "string" && validShifts.has(shift as ShiftCode),
        )
      : [];
    const priority =
      typeof candidate.priority === "number" && candidate.priority >= 1 && candidate.priority <= 4
        ? (candidate.priority as 1 | 2 | 3 | 4)
        : request.priority;
    return {
      ...request,
      allowedAssignments: allowedAssignments.length
        ? allowedAssignments
        : request.allowedAssignments,
      priority,
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
  return response.versions.find((version) => version.versionNo === 2) ?? response.versions[0];
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

function makeDemoCsv(dataset: ScheduleDataset, version: ScheduleVersion) {
  const dates = getDates(dataset.period.startDate, dataset.period.endDate);
  const assignmentMap = new Map(
    version.assignments.map((assignment) => [
      `${assignment.nurseId}:${assignment.date}`,
      assignment.shift,
    ]),
  );
  const rows = [
    ["Nickname", "Skill level", ...dates],
    ...dataset.nurses.map((nurse) => [
      nurse.nickname,
      nurse.skillLevel,
      ...dates.map((date) => assignmentMap.get(`${nurse.id}:${date}`) ?? "OFF"),
    ]),
  ];
  return rows
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
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
  const reviewRequests = workingDataset.requests.filter((request) => request.requiresReview);
  const activeStepIndex = WORKFLOW_STEPS.findIndex((step) => step.id === activeStep);
  const selectedOutcome = activeVersion ? getOutcome(activeVersion, selected) : undefined;
  const rejectedOutcomes = activeVersion?.requestOutcomes.filter((outcome) => !outcome.satisfied) ?? [];
  const isDemoSnapshot = activeVersion?.solverStatus === "DEMO";
  const confirmationEligibility = getConfirmationEligibility(activeVersion);
  const confirmationGate = getConfirmationGatePresentation(activeVersion);
  const hardRuleStateLabel = confirmationGate.state === "CONFIRMED"
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

  const applyResponse = useCallback((next: GenerateScheduleResponse) => {
    setResponse(next);
    setStagedDataset(null);
    const nextVersion = preferredVersion(next);
    setActiveVersionId(nextVersion?.id ?? next.versions[0]?.id);
    setSelected(initialSelection(next));
    setExplanation("");
    setResolvedReviewCount(0);
  }, []);

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
      setNotice(
        `${normalized.dataset.nurses.length} nickname-only records imported. ${normalized.dataset.requests.filter((request) => request.requiresReview).length} values require review${normalized.provider === "openai" ? " with OpenAI suggestions" : ""}.${normalizationWarning}`,
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
    setNotice(`${reviewRequests.length} ambiguous values resolved. The dataset is ready to optimize.`);
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
      applyResponse(parsed);
      setConnectionMode(parsed.mode === "solver" ? "live" : "demo");
      setNotice(
        parsed.mode === "solver"
          ? "Optimization complete. Three validated candidate schedules are ready."
          : "A precomputed showcase response was loaded. It is labelled DEMO until fresh solver output is available.",
      );
    } catch (error) {
      setConnectionMode(networkOnline ? "error" : "offline");
      setNotice(
        error instanceof Error
          ? `${error.message} The previous validated candidates remain on screen.`
          : "Optimization failed. The previous validated candidates remain on screen.",
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
    if (!confirmationEligibility.eligible) {
      setConnectionMode("error");
      setNotice(confirmationEligibility.message);
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
      if (!result.ok) throw new Error(`Export endpoint returned ${result.status}.`);
      const blob = await result.blob();
      downloadBlob(blob, `nurseflow-${response.dataset.period.code}-v${activeVersion.versionNo}.xlsx`);
      setNotice("Excel export created from the selected schedule version.");
    } catch {
      const csv = makeDemoCsv(response.dataset, activeVersion);
      downloadBlob(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `nurseflow-${response.dataset.period.code}-v${activeVersion.versionNo}-demo.csv`,
      );
      setNotice("Export API unavailable. A clearly labelled CSV showcase snapshot was downloaded instead.");
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
            <i aria-hidden="true" /> Nickname-only synthetic data
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
            disabled={busyAction === "export"}
            onClick={() => void handleExport()}
          >
            {busyAction === "export" ? "Preparing..." : "Export"}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={busyAction === "confirm" || !confirmationEligibility.eligible}
            title={confirmationEligibility.eligible ? undefined : confirmationGate.disabledReason}
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
          const isComplete = index < activeStepIndex || activeVersion.status === "CONFIRMED";
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
              <p>Raw values stay visible beside the suggested normalized meaning.</p>
            </div>
            <div className="review-preview">
              {reviewRequests.map((request) => (
                <div key={`${request.nurseId}:${request.date}`}>
                  <span>{reviewNurseById.get(request.nurseId)?.nickname ?? "Nickname"}</span>
                  <strong>{request.rawValue}</strong>
                  <small>
                    {Math.round(request.confidence * 100)}% confidence | {request.allowedAssignments.join(" / ")}
                  </small>
                </div>
              ))}
            </div>
            <button className="button button--primary" type="button" onClick={handleResolveAll}>
              {resolvedReviewCount === reviewRequests.length ? "Mappings accepted" : "Accept suggestions"}
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
              <p>Changed cells are marked. Compare request satisfaction, balance, and L0 usage.</p>
            </div>
            <div className="compare-callout">
              <strong>{formatPercent(activeVersion.metrics.offSatisfactionRate)}</strong>
              <span>OFF requests preserved</span>
            </div>
            <button className="button button--primary" type="button" onClick={() => setActiveStep("confirm")}>
              Choose version {activeVersion.versionNo}
            </button>
          </>
        ) : null}

        {activeStep === "confirm" ? (
          <>
            <div className="dock-copy">
              <p className="eyebrow">05 / Confirm</p>
              <h2 id="action-dock-title">Lock the selected decision</h2>
              <p>{confirmationGate.description}</p>
            </div>
            <div className={`confirmation-gate ${confirmationGate.className}`}>
              <span>{confirmationGate.label}</span>
              <strong>{confirmationGate.summary}</strong>
            </div>
            <div className="dock-actions">
              <button
                className="button button--primary"
                type="button"
                disabled={busyAction === "confirm" || !confirmationEligibility.eligible}
                title={confirmationEligibility.eligible ? undefined : confirmationGate.disabledReason}
                onClick={() => void handleConfirm()}
              >
                {activeVersion.status === "CONFIRMED" ? "Confirmed" : "Confirm schedule"}
              </button>
              <button
                className="button button--ghost"
                type="button"
                disabled={busyAction === "export"}
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
          <strong>10D / 9N</strong>
          <small>Every day</small>
        </div>
        <div>
          <span>Hard rules</span>
          <strong>
            {confirmationEligibility.hardTotal > 0
              ? `${confirmationEligibility.hardPassed}/${confirmationEligibility.hardTotal}`
              : "No evidence"}
          </strong>
          <small>{hardRuleStateLabel}</small>
        </div>
        <div>
          <span>OFF preserved</span>
          <strong>{formatPercent(activeVersion.metrics.offSatisfactionRate)}</strong>
          <small>O1 at {formatPercent(activeVersion.metrics.o1SatisfactionRate)}</small>
        </div>
        <div>
          <span>Balance</span>
          <strong>{formatPercent((activeVersion.metrics.dayBalanceScore + activeVersion.metrics.nightBalanceScore) / 2)}</strong>
          <small>Day and Night</small>
        </div>
        <div>
          <span>Member L0</span>
          <strong>{activeVersion.metrics.memberL0Usage}</strong>
          <small>Clinical shifts</small>
        </div>
        <div>
          <span>Version state</span>
          <strong>{activeVersion.status}</strong>
          <small>{activeVersion.solverStatus}</small>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="schedule-surface">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">Decision surface</p>
              <div className="surface-title-line">
                <h2>August roster</h2>
                {isDemoSnapshot ? <span>Precomputed / DEMO</span> : null}
              </div>
              <p>Click any assignment for context. A dot marks changes from version 1.</p>
            </div>
            <div className="surface-tools">
              <div className="shift-legend" aria-label="Shift legend">
                {(["D", "N", "OFF", "VAC", "ED"] as const).map((shift) => (
                  <span key={shift}><i className={`legend-${shift.toLowerCase()}`} />{shift}</span>
                ))}
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

          <ScheduleMatrix
            nurses={response.dataset.nurses}
            version={activeVersion}
            baselineVersion={baselineVersion}
            dateWindow={dateWindow}
            selected={selected}
            onSelect={selectAssignment}
          />

          <footer className="surface-footer">
            <span>{response.dataset.sourceLabel}</span>
            <span>Context included: 29-31 Jul 2026</span>
            <span>{isDemoSnapshot ? "Snapshot" : "Generated"} {formatDateTime(activeVersion.generatedAt)}</span>
          </footer>
        </div>

        <aside className="decision-rail" aria-label="Schedule evidence and validation">
          <section className="assignment-focus">
            <p className="eyebrow">Selected decision</p>
            {selected ? (
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
                  disabled={!selectedOutcome || busyAction === "explain"}
                  onClick={() => void handleExplain()}
                >
                  {busyAction === "explain" ? "Checking evidence..." : "Explain with AI evidence"}
                </button>
              </>
            ) : (
              <p className="muted-copy">Choose an assignment in the roster.</p>
            )}
          </section>

          <section className="exception-list">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">Needs explanation</p>
                <h3>Unfulfilled requests</h3>
              </div>
              <span>{rejectedOutcomes.length}</span>
            </div>
            {rejectedOutcomes.length ? (
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
              <span>{confirmationGate.summary}</span>
            </div>
            {confirmationEligibility.validations.length ? (
              <ul>
                {confirmationEligibility.validations.map((validation) => (
                  <li key={validation.code} className={`is-${validation.status.toLowerCase()}`}>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{validation.name}</strong>
                      <small>{validation.violationCount} violations</small>
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
          <h2 id="version-ledger-title">One safe roster, different priorities</h2>
          <p>All candidates pass hard rules. Select a row to update the roster and decision evidence.</p>
        </div>
        <div className="version-rows">
          {response.versions.map((version) => {
            const isActive = version.id === activeVersion.id;
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
                  <small>{version.status} / score {version.objectiveScore?.toLocaleString() ?? "-"}</small>
                </span>
                <span><small>OFF preserved</small><strong>{formatPercent(version.metrics.offSatisfactionRate)}</strong></span>
                <span><small>Day balance</small><strong>{formatPercent(version.metrics.dayBalanceScore)}</strong></span>
                <span><small>Night balance</small><strong>{formatPercent(version.metrics.nightBalanceScore)}</strong></span>
                <span><small>Member L0</small><strong>{version.metrics.memberL0Usage}</strong></span>
                <b>{isActive ? "Viewing" : "Compare"}</b>
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
        <p>Showcase data uses synthetic nicknames only. Human approval remains required.</p>
      </footer>
    </main>
  );
}
