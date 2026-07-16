import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";
import { getAdminSessionFromToken } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/favicon.ico",
  "/icon.svg",
  "/apple-icon.png",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
]);
const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = await getAdminSessionFromToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (path === "/login" && session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (PUBLIC_PATHS.has(path)) {
    return NextResponse.next();
  }

  if (!session && path.startsWith("/api/")) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Admin authentication is required." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|icon.svg|apple-icon.png|robots.txt|sitemap.xml|manifest.webmanifest).*)",
  ],
};
