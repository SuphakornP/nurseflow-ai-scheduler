import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { sessionCookieOptions } from "@/lib/auth/cookie";
import { resetLoginRateLimitForTests } from "@/lib/auth/rate-limit";

const environment = {
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "a-secure-password",
  ADMIN_DISPLAY_NAME: "Head Scheduler",
  AUTH_SECRET: "auth-secret-with-more-than-thirty-two-characters",
};

function loginRequest(body: unknown, ipAddress = "127.0.0.1") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-real-ip": ipAddress,
    },
    body: JSON.stringify(body),
  });
}

describe("auth endpoints", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    resetLoginRateLimitForTests();
  });

  it("sets a host-only HttpOnly strict session cookie after valid login", async () => {
    const response = await login(
      loginRequest({ email: environment.ADMIN_EMAIL, password: environment.ADMIN_PASSWORD }),
    );
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("nurseflow_admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });

  it("marks the session cookie Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("returns the same 401 response for malformed and incorrect credentials", async () => {
    const incorrect = await login(
      loginRequest({ email: environment.ADMIN_EMAIL, password: "wrong-password" }, "127.0.0.2"),
    );
    const malformed = await login(loginRequest({ email: environment.ADMIN_EMAIL }, "127.0.0.3"));

    expect(incorrect.status).toBe(401);
    expect(malformed.status).toBe(401);
    await expect(incorrect.json()).resolves.toEqual(await malformed.json());
  });

  it("returns 503 without revealing which auth setting is missing", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const response = await login(
      loginRequest({ email: environment.ADMIN_EMAIL, password: environment.ADMIN_PASSWORD }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AUTH_UNAVAILABLE",
      message: "Admin access is not configured.",
    });
  });

  it("allows five failures and throttles the sixth even when forwarded IP headers rotate", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(
        loginRequest(
          { email: environment.ADMIN_EMAIL, password: "wrong-password" },
          `198.51.100.${attempt + 1}`,
        ),
      );
      expect(response.status).toBe(401);
    }
    const blocked = await login(
      loginRequest(
        { email: environment.ADMIN_EMAIL, password: environment.ADMIN_PASSWORD },
        "203.0.113.50",
      ),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects cross-origin login", async () => {
    const crossOrigin = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: JSON.stringify({
          email: environment.ADMIN_EMAIL,
          password: environment.ADMIN_PASSWORD,
        }),
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("rejects logout without an exact same-origin request", async () => {
    const missingOrigin = await logout(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    const crossOrigin = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(missingOrigin.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
  });

  it("clears the session and uses a same-origin relative redirect on logout", async () => {
    const response = await logout(
      new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
