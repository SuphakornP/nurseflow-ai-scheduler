export const ADMIN_ROLE = "ADMIN" as const;

export interface AdminConfig {
  email: string;
  password: string;
  displayName: string;
  secret: string;
}

export interface AdminSession {
  email: string;
  displayName: string;
  role: typeof ADMIN_ROLE;
  expiresAt: string;
}
