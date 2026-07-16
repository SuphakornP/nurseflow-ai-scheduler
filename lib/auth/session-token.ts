import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { SESSION_TTL_SECONDS } from "@/lib/auth/cookie";
import { ADMIN_ROLE, type AdminConfig, type AdminSession } from "@/lib/auth/types";

export const SESSION_ISSUER = "nurseflow-ai";
export const SESSION_AUDIENCE = "nurseflow-admin";

const SessionPayloadSchema = z
  .object({
    iss: z.literal(SESSION_ISSUER),
    aud: z.literal(SESSION_AUDIENCE),
    sub: z.email(),
    email: z.email(),
    displayName: z.string().min(1).max(80),
    role: z.literal(ADMIN_ROLE),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    jti: z.string().min(1).max(200),
  })
  .strict();

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createAdminSessionToken(
  config: AdminConfig,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1_000);

  return new SignJWT({
    email: config.email,
    displayName: config.displayName,
    role: ADMIN_ROLE,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(config.email)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
    .setJti(globalThis.crypto.randomUUID())
    .sign(signingKey(config.secret));
}

export async function verifyAdminSessionToken(
  token: string,
  config: AdminConfig,
  now = new Date(),
): Promise<AdminSession | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, signingKey(config.secret), {
      algorithms: ["HS256"],
      audience: SESSION_AUDIENCE,
      issuer: SESSION_ISSUER,
      currentDate: now,
    });
    if (protectedHeader.typ !== "JWT") return null;

    const parsed = SessionPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;

    const currentTime = Math.floor(now.getTime() / 1_000);
    if (
      parsed.data.email !== config.email ||
      parsed.data.sub !== config.email ||
      parsed.data.displayName !== config.displayName ||
      parsed.data.iat > currentTime + 60 ||
      parsed.data.exp - parsed.data.iat !== SESSION_TTL_SECONDS
    ) {
      return null;
    }

    return {
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      expiresAt: new Date(parsed.data.exp * 1_000).toISOString(),
    };
  } catch {
    return null;
  }
}
