import { createHash, timingSafeEqual } from "node:crypto";

import { normalizeAdminEmail } from "@/lib/auth/config";
import type { AdminConfig } from "@/lib/auth/types";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

export function credentialsMatch(
  email: string,
  password: string,
  config: AdminConfig,
): boolean {
  const emailMatches = constantTimeEqual(normalizeAdminEmail(email), config.email);
  const passwordMatches = constantTimeEqual(password, config.password);
  return emailMatches && passwordMatches;
}
