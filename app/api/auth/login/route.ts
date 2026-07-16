import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/cookie";
import { AuthConfigurationError } from "@/lib/auth/config";
import { credentialsMatch } from "@/lib/auth/credentials";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  loginAttemptKey,
  recordLoginFailure,
} from "@/lib/auth/rate-limit";
import { isSameOriginRequest, sameOriginError } from "@/lib/auth/request";
import { getAdminConfig } from "@/lib/auth/server-config";
import { createAdminSessionToken } from "@/lib/auth/session-token";

const LoginSchema = z
  .object({
    email: z.string().max(320),
    password: z.string().max(1_024),
  })
  .strict();

const NO_STORE_HEADERS = { "cache-control": "no-store" };

function unauthorized() {
  return NextResponse.json(
    { error: "INVALID_CREDENTIALS", message: "The email or password is incorrect." },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return sameOriginError();

  let config;
  try {
    config = getAdminConfig();
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    return NextResponse.json(
      { error: "AUTH_UNAVAILABLE", message: "Admin access is not configured." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
  const email = parsed.success ? parsed.data.email : "invalid";
  // This single-admin bucket cannot be bypassed by spoofing forwarded-IP headers.
  const key = loginAttemptKey(email);
  const rateLimit = checkLoginRateLimit(key);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS", message: "Too many sign-in attempts. Try again later." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "retry-after": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  if (!parsed.success || !credentialsMatch(parsed.data.email, parsed.data.password, config)) {
    recordLoginFailure(key);
    return unauthorized();
  }

  clearLoginFailures(key);
  const response = NextResponse.json(
    {
      authenticated: true,
      user: { displayName: config.displayName, role: "ADMIN" },
    },
    { headers: NO_STORE_HEADERS },
  );
  response.cookies.set(
    SESSION_COOKIE_NAME,
    await createAdminSessionToken(config),
    sessionCookieOptions(),
  );
  return response;
}
