import "server-only";

import type { SourceWorkbookTemplate } from "@/lib/source-workbook-template";

interface CacheEntry {
  value: SourceWorkbookTemplate;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 8 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 4;

function removeExpiredEntries(now: number) {
  for (const [periodId, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(periodId);
  }
}

export function cacheSourceWorkbookTemplate(periodId: string, template: SourceWorkbookTemplate) {
  const now = Date.now();
  removeExpiredEntries(now);
  cache.delete(periodId);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestPeriodId = cache.keys().next().value;
    if (typeof oldestPeriodId !== "string") break;
    cache.delete(oldestPeriodId);
  }
  cache.set(periodId, { value: template, expiresAt: now + TTL_MS });
}

export function getSourceWorkbookTemplate(periodId: string, expectedSourceHash?: string) {
  const entry = cache.get(periodId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(periodId);
    return null;
  }
  if (expectedSourceHash && entry.value.sourceHash !== expectedSourceHash) return null;
  return entry.value;
}

export function resetSourceWorkbookTemplateCacheForTests() {
  cache.clear();
}
