import { redirect } from "next/navigation";

import { NurseFlowWorkspace } from "@/components/nurseflow-workspace";
import { getAdminSession } from "@/lib/auth/session";

export default async function HomePage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  return <NurseFlowWorkspace admin={session} />;
}
