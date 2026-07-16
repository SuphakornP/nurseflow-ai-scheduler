import { NextResponse } from "next/server";

import { getAdminSessionFromRequest } from "@/lib/auth/session";
import type { AdminSession } from "@/lib/auth/types";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") ?? requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const requestProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
    return originUrl.host === requestHost && originUrl.protocol === requestProtocol;
  } catch {
    return false;
  }
}

export function sameOriginError() {
  return NextResponse.json(
    { error: "INVALID_REQUEST_ORIGIN", message: "The request origin is not allowed." },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}

export type AdminRequestResult =
  | { ok: true; session: AdminSession }
  | { ok: false; response: NextResponse };

export async function requireAdminRequest(
  request: Request,
  options: { sameOrigin?: boolean } = {},
): Promise<AdminRequestResult> {
  const session = await getAdminSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHORIZED", message: "Admin authentication is required." },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }

  if (options.sameOrigin && !isSameOriginRequest(request)) {
    return { ok: false, response: sameOriginError() };
  }

  return { ok: true, session };
}
