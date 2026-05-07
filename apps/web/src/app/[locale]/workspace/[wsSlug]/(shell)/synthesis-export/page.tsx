import { notFound } from "next/navigation";
import { isSynthesisExportEnabled } from "@/lib/feature-flags";
import { SynthesisPanel } from "@/components/synthesis-export/SynthesisPanel";
import { apiClient } from "@/lib/api-client";

// API contract verified against:
// - apps/api/src/routes/workspaces.ts → GET /workspaces/by-slug/:slug
//   returns { id, slug, name, role }

interface WorkspaceLite {
  id: string;
  slug: string;
  name: string;
  role: string;
}

export default async function SynthesisExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ wsSlug: string; locale: string }>;
  searchParams?: Promise<{ project?: string }>;
}) {
  if (!isSynthesisExportEnabled()) notFound();
  const { wsSlug } = await params;
  const query = (await searchParams) ?? {};
  const ws = await apiClient<WorkspaceLite>(`/workspaces/by-slug/${wsSlug}`);
  return (
    <SynthesisPanel workspaceId={ws.id} projectId={query.project ?? null} />
  );
}
