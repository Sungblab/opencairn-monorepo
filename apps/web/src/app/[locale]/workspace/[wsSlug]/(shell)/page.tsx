import { apiClient } from "@/lib/api-client";
import { DashboardViewLoader } from "@/components/views/dashboard/dashboard-view-loader";

// Replaces the Phase 1 placeholder with the real dashboard. We resolve the
// workspace slug → id server-side so every card downstream works with a
// stable uuid (matches Phase D's research hub pattern).
export default async function WorkspaceDashboard({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  const ws = await apiClient<{ id: string }>(
    `/workspaces/by-slug/${wsSlug}`,
  );
  return <DashboardViewLoader wsSlug={wsSlug} wsId={ws.id} />;
}
