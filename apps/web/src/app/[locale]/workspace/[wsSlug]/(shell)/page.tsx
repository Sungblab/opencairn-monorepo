import { apiClient } from "@/lib/api-client";
import { DashboardViewLoader } from "@/components/views/dashboard/dashboard-view-loader";
import { urls } from "@/lib/urls";
import { redirect } from "next/navigation";

// Replaces the Phase 1 placeholder with the real dashboard. We resolve the
// workspace slug → id server-side so every card downstream works with a
// stable uuid (matches Phase D's research hub pattern).
export default async function WorkspaceDashboard({
  params,
}: {
  params: Promise<{ locale: string; wsSlug: string }>;
}) {
  const { locale, wsSlug } = await params;
  const ws = await apiClient<{ id: string }>(
    `/workspaces/by-slug/${wsSlug}`,
  );
  const projects = await apiClient<Array<{ id: string }>>(
    `/workspaces/${ws.id}/projects`,
  );
  if (projects[0]) {
    redirect(urls.workspace.project(locale, wsSlug, projects[0].id));
  }
  return <DashboardViewLoader wsSlug={wsSlug} wsId={ws.id} />;
}
