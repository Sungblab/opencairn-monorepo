import { apiClient } from "@/lib/api-client";
import { WorkspaceSettingsView } from "@/components/views/workspace-settings/workspace-settings-view";

// App Shell Phase 5 Task 6 — replaces the Phase 1 placeholder. Sub route
// (/settings/<sub>) is read from the optional catch-all segment and threaded
// to the client view as a discriminator. wsId is resolved server-side so
// every tab's API helper works with a stable uuid.
export default async function WsSettings({
  params,
}: {
  params: Promise<{ wsSlug: string; slug?: string[] }>;
}) {
  const { wsSlug, slug } = await params;
  const ws = await apiClient<{ id: string }>(
    `/workspaces/by-slug/${wsSlug}`,
  );
  return (
    <WorkspaceSettingsView
      wsSlug={wsSlug}
      wsId={ws.id}
      sub={slug?.[0] ?? "members"}
    />
  );
}
