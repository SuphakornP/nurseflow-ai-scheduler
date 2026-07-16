import "server-only";

import type { GenerateScheduleResponse } from "@/lib/types";

interface CacheEntry {
  value: GenerateScheduleResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000;

export function cacheSchedule(response: GenerateScheduleResponse) {
  cache.set(response.dataset.period.id, { value: response, expiresAt: Date.now() + TTL_MS });
}

export function getCachedSchedule(periodId: string) {
  const entry = cache.get(periodId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(periodId);
    return null;
  }
  return entry.value;
}
