import { z } from "zod";

import type { AdminConfig } from "@/lib/auth/types";

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const AUTH_SECRET_MIN_LENGTH = 32;

const AdminConfigSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(1_024),
    displayName: z.string().min(1).max(80),
    secret: z.string().min(AUTH_SECRET_MIN_LENGTH).max(4_096),
  })
  .strict();

type Environment = Record<string, string | undefined>;

export class AuthConfigurationError extends Error {
  constructor() {
    super("Admin authentication is not configured.");
    this.name = "AuthConfigurationError";
  }
}

export function normalizeAdminEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function parseAdminConfig(environment: Environment): AdminConfig {
  const parsed = AdminConfigSchema.safeParse({
    email: normalizeAdminEmail(environment.ADMIN_EMAIL ?? ""),
    password: environment.ADMIN_PASSWORD,
    displayName: environment.ADMIN_DISPLAY_NAME?.trim(),
    secret: environment.AUTH_SECRET,
  });

  if (!parsed.success) {
    throw new AuthConfigurationError();
  }

  return parsed.data;
}
