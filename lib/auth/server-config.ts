import "server-only";

import { parseAdminConfig } from "@/lib/auth/config";

export function getAdminConfig() {
  return parseAdminConfig(process.env);
}
