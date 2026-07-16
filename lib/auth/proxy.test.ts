import { getRedirectUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";
import { createAdminSessionToken } from "@/lib/auth/session-token";
import { config, proxy } from "@/proxy";

const environment = {
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "a-secure-password",
  ADMIN_DISPLAY_NAME: "Head Scheduler",
  AUTH_SECRET: "auth-secret-with-more-than-thirty-two-characters",
};

describe("admin proxy", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  });

  it("redirects an anonymous page request to login", async () => {
    const response = await proxy(new NextRequest("http://localhost/"));
    expect(getRedirectUrl(response)).toBe("http://localhost/login");
  });

  it("returns 401 JSON for an anonymous API request", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/health"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("allows a valid admin session through", async () => {
    const token = await createAdminSessionToken(
      {
        email: environment.ADMIN_EMAIL,
        password: environment.ADMIN_PASSWORD,
        displayName: environment.ADMIN_DISPLAY_NAME,
        secret: environment.AUTH_SECRET,
      },
      new Date(),
    );
    const response = await proxy(
      new NextRequest("http://localhost/", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects an authenticated admin away from login", async () => {
    const token = await createAdminSessionToken(
      {
        email: environment.ADMIN_EMAIL,
        password: environment.ADMIN_PASSWORD,
        displayName: environment.ADMIN_DISPLAY_NAME,
        secret: environment.AUTH_SECRET,
      },
      new Date(),
    );
    const response = await proxy(
      new NextRequest("http://localhost/login", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );
    expect(getRedirectUrl(response)).toBe("http://localhost/");
  });

  it("keeps static metadata outside the admin gate", async () => {
    const response = await proxy(new NextRequest("http://localhost/icon.svg"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(config.matcher[0]).toContain("icon.svg");
  });
});
