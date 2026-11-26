import "server-only";

import { TemporaryCache } from "@/lib/temporary-cache";
import type { GenerateScheduleResponse, ScheduleDataset, ScheduleVersion } from "@/lib/types";

interface GeneratedCandidate {
  dataset: ScheduleDataset;
  version: ScheduleVersion;
  generation: {
    confirmation?: { versionId: string; confirmedAt: string };
  };
}

// Route bundles in the same Next.js process must see the same temporary data.
const runtime = globalThis as typeof globalThis & {
  nurseFlowCandidates?: TemporaryCache<GeneratedCandidate>;
};
const candidates = runtime.nurseFlowCandidates ??= new TemporaryCache<GeneratedCandidate>(
  12,
  30 * 60 * 1000,
);

export function cacheSchedule(sessionId: string, response: GenerateScheduleResponse) {
  const generation: GeneratedCandidate["generation"] = {};
  for (const version of response.versions) {
    const key = JSON.stringify([sessionId, response.dataset.period.id, version.id]);
    candidates.set(key, { dataset: response.dataset, version, generation });
  }
}

export function getCachedCandidate(sessionId: string, periodId: string, versionId: string) {
  return candidates.get(JSON.stringify([sessionId, periodId, versionId]));
}
