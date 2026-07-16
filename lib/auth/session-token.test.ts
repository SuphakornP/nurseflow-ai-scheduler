import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { SESSION_TTL_SECONDS } from "@/lib/auth/cookie";
import {
  createAdminSessionToken,
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  verifyAdminSessionToken,
} from "@/lib/auth/session-token";
import type { AdminConfig } from "@/lib/auth/types";

const config: AdminConfig = {
  email: "admin@example.com",
  password: "a-secure-password",
  displayName: "Head Scheduler",
  secret: "auth-secret-with-more-than-thirty-two-characters",
};
const issuedAt = new Date("2026-07-16T02:00:00.000Z");

describe("admin session token", () => {
  it("verifies a valid eight-hour ADMIN session", async () => {
    const token = await createAdminSessionToken(config, issuedAt);
    await expect(
      verifyAdminSessionToken(token, config, new Date("2026-07-16T03:00:00.000Z")),
    ).resolves.toMatchObject({
      email: config.email,
      displayName: config.displayName,
      role: "ADMIN",
      expiresAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("rejects expired, tampered, and rotated-secret sessions", async () => {
    const token = await createAdminSessionToken(config, issuedAt);
    const parts = token.split(".");
    parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;

    await expect(
      verifyAdminSessionToken(token, config, new Date("2026-07-16T10:00:01.000Z")),
    ).resolves.toBeNull();
    await expect(verifyAdminSessionToken(parts.join("."), config, issuedAt)).resolves.toBeNull();
    await expect(
      verifyAdminSessionToken(token, { ...config, secret: "rotated-secret-with-more-than-32-characters" }, issuedAt),
    ).resolves.toBeNull();
  });

  it("rejects a correctly signed token with the wrong role", async () => {
    const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000);
    const token = await new SignJWT({
      email: config.email,
      displayName: config.displayName,
      role: "USER",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setSubject(config.email)
      .setIssuedAt(issuedAtSeconds)
      .setExpirationTime(issuedAtSeconds + SESSION_TTL_SECONDS)
      .setJti("wrong-role")
      .sign(new TextEncoder().encode(config.secret));

    await expect(verifyAdminSessionToken(token, config, issuedAt)).resolves.toBeNull();
  });
});
