import { notFound } from "next/navigation";
import {
  isDeepResearchEnabled,
  isManagedDeepResearchEnabled,
} from "@/lib/feature-flags";
import { ResearchHubLoader } from "@/components/research/ResearchHubLoader";
import { apiClient } from "@/lib/api-client";

// API contract verified against:
// - apps/api/src/routes/workspaces.ts:119 → GET /workspaces/by-slug/:slug
//   returns { id, slug, name, role }
// - apps/api/src/routes/projects.ts:16    → GET /workspaces/:wsId/projects
//   returns array of project rows including { id, name }

interface WorkspaceLite {
  id: string;
  slug: string;
  name: string;
  role: string;
}
interface ProjectRow {
  id: string;
  name: string;
}

export default async function ResearchHubPage({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  if (!isDeepResearchEnabled()) notFound();
  const { wsSlug } = await params;

  const ws = await apiClient<WorkspaceLite>(`/workspaces/by-slug/${wsSlug}`);
  const projects = await apiClient<ProjectRow[]>(
    `/workspaces/${ws.id}/projects`,
  );

  return (
    <ResearchHubLoader
      wsSlug={wsSlug}
      workspaceId={ws.id}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      managedEnabled={isManagedDeepResearchEnabled()}
    />
  );
}
