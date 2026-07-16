import { describe, expect, it } from "vitest";

import {
  AuthConfigurationError,
  parseAdminConfig,
} from "@/lib/auth/config";
import { credentialsMatch } from "@/lib/auth/credentials";

const validEnvironment = {
  ADMIN_EMAIL: "Admin@Example.com ",
  ADMIN_PASSWORD: "a-secure-password",
  ADMIN_DISPLAY_NAME: " Head Scheduler ",
  AUTH_SECRET: "auth-secret-with-more-than-thirty-two-characters",
};

describe("admin configuration", () => {
  it("normalizes the email and display name", () => {
    expect(parseAdminConfig(validEnvironment)).toEqual({
      email: "admin@example.com",
      password: "a-secure-password",
      displayName: "Head Scheduler",
      secret: "auth-secret-with-more-than-thirty-two-characters",
    });
  });

  it.each([
    ["ADMIN_EMAIL", ""],
    ["ADMIN_PASSWORD", "short"],
    ["ADMIN_DISPLAY_NAME", ""],
    ["AUTH_SECRET", "short"],
  ])("rejects an invalid %s", (key, value) => {
    expect(() => parseAdminConfig({ ...validEnvironment, [key]: value })).toThrow(
      AuthConfigurationError,
    );
  });
});

describe("credential comparison", () => {
  const config = parseAdminConfig(validEnvironment);

  it("accepts the configured credentials and normalizes email casing", () => {
    expect(credentialsMatch(" ADMIN@example.com ", "a-secure-password", config)).toBe(true);
  });

  it("rejects either an incorrect email or password", () => {
    expect(credentialsMatch("other@example.com", "a-secure-password", config)).toBe(false);
    expect(credentialsMatch("admin@example.com", "wrong-password", config)).toBe(false);
  });
});
