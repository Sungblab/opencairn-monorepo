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
}: {
  params: Promise<{ wsSlug: string; locale: string }>;
}) {
  if (!isSynthesisExportEnabled()) notFound();
  const { wsSlug } = await params;
  const ws = await apiClient<WorkspaceLite>(`/workspaces/by-slug/${wsSlug}`);
  return <SynthesisPanel workspaceId={ws.id} projectId={null} />;
}
