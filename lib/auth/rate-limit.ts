import { createHash } from "node:crypto";

import { normalizeAdminEmail } from "@/lib/auth/config";

export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_TRACKED_ATTEMPTS = 5_000;

interface AttemptRecord {
  count: number;
  windowStartedAt: number;
}

declare global {
  var __nurseFlowLoginAttempts: Map<string, AttemptRecord> | undefined;
}

function attempts() {
  globalThis.__nurseFlowLoginAttempts ??= new Map<string, AttemptRecord>();
  return globalThis.__nurseFlowLoginAttempts;
}

function prune(now: number) {
  const store = attempts();
  for (const [key, record] of store) {
    if (now - record.windowStartedAt >= LOGIN_WINDOW_MS) store.delete(key);
  }
  while (store.size > MAX_TRACKED_ATTEMPTS) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

export function loginAttemptKey(email: string): string {
  return createHash("sha256")
    .update("single-admin\0")
    .update(normalizeAdminEmail(email).slice(0, 320))
    .digest("hex");
}

export function checkLoginRateLimit(key: string, now = Date.now()) {
  prune(now);
  const record = attempts().get(key);
  if (!record || now - record.windowStartedAt >= LOGIN_WINDOW_MS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((LOGIN_WINDOW_MS - (now - record.windowStartedAt)) / 1_000),
  );
  return { allowed: record.count < LOGIN_ATTEMPT_LIMIT, retryAfterSeconds };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  prune(now);
  const current = attempts().get(key);
  if (!current || now - current.windowStartedAt >= LOGIN_WINDOW_MS) {
    attempts().set(key, { count: 1, windowStartedAt: now });
    return;
  }
  current.count += 1;
}

export function clearLoginFailures(key: string) {
  attempts().delete(key);
}

export function resetLoginRateLimitForTests() {
  attempts().clear();
}
