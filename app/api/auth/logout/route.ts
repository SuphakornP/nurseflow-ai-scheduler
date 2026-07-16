import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/cookie";
import { isSameOriginRequest, sameOriginError } from "@/lib/auth/request";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return sameOriginError();

  const response = new NextResponse(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: "/login",
    },
  });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
