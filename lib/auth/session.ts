import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, readCookie } from "@/lib/auth/cookie";
import { AuthConfigurationError } from "@/lib/auth/config";
import { getAdminConfig } from "@/lib/auth/server-config";
import { verifyAdminSessionToken } from "@/lib/auth/session-token";

export async function getAdminSessionFromToken(token: string | null | undefined) {
  if (!token) return null;

  try {
    return await verifyAdminSessionToken(token, getAdminConfig());
  } catch (error) {
    if (error instanceof AuthConfigurationError) return null;
    throw error;
  }
}

export async function getAdminSessionFromRequest(request: Request) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  return getAdminSessionFromToken(token);
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  return getAdminSessionFromToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
