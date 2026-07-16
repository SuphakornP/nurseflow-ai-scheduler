import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLogin } from "@/components/admin-login";
import { getAdminSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Admin sign in | NurseFlow AI",
  description: "Administrator access checkpoint for the NurseFlow AI scheduling workspace.",
};

export default async function LoginPage() {
  const session = await getAdminSession();

  if (session) {
    redirect("/");
  }

  return <AdminLogin />;
}
