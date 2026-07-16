import { describe, expect, it, vi } from "vitest";

import { POST as confirm } from "@/app/api/confirm/route";
import { POST as demo } from "@/app/api/demo/route";
import { POST as explain } from "@/app/api/explain/route";
import { POST as exportSchedule } from "@/app/api/export/route";
import { POST as generate } from "@/app/api/generate/route";
import { GET as health } from "@/app/api/health/route";
import { GET as history } from "@/app/api/history/route";
import { POST as importSchedule } from "@/app/api/import/route";
import { POST as normalize } from "@/app/api/normalize/route";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";
import { isSameOriginRequest } from "@/lib/auth/request";
import { createAdminSessionToken } from "@/lib/auth/session-token";

const protectedHandlers = [
  ["confirm", confirm, "POST"],
  ["demo", demo, "POST"],
  ["explain", explain, "POST"],
  ["export", exportSchedule, "POST"],
  ["generate", generate, "POST"],
  ["health", health, "GET"],
  ["history", history, "GET"],
  ["import", importSchedule, "POST"],
  ["normalize", normalize, "POST"],
] as const;

describe("route-level admin enforcement", () => {
  it("uses the request Host when Next.js canonicalizes the request URL", () => {
    expect(
      isSameOriginRequest(
        new Request("http://localhost:3000/api/confirm", {
          method: "POST",
          headers: {
            host: "127.0.0.1:3000",
            origin: "http://127.0.0.1:3000",
          },
        }),
      ),
    ).toBe(true);
  });

  it.each(protectedHandlers)("rejects anonymous access to %s before route work", async (
    path,
    handler,
    method,
  ) => {
    const response = await handler(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: method === "POST" ? { origin: "http://localhost" } : undefined,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("rejects a cross-origin state-changing request with a valid session", async () => {
    const config = {
      email: "admin@example.com",
      password: "a-secure-password",
      displayName: "Head Scheduler",
      secret: "auth-secret-with-more-than-thirty-two-characters",
    };
    vi.stubEnv("ADMIN_EMAIL", config.email);
    vi.stubEnv("ADMIN_PASSWORD", config.password);
    vi.stubEnv("ADMIN_DISPLAY_NAME", config.displayName);
    vi.stubEnv("AUTH_SECRET", config.secret);
    const token = await createAdminSessionToken(config);

    const response = await normalize(
      new Request("http://localhost/api/normalize", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          origin: "https://attacker.example",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_REQUEST_ORIGIN" });
  });
});
