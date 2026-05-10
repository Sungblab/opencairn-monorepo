import { ProjectViewLoader } from "@/components/views/project/project-view-loader";

// App Shell Phase 5 Task 2 — project view inside the (shell) route group so
// it picks up the App Shell sidebar / tab bar / agent panel. The legacy
// p/[projectId]/page.tsx used the old standalone Sidebar — that file is
// removed in the same commit to keep route resolution unambiguous.
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;
  return <ProjectViewLoader wsSlug={wsSlug} projectId={projectId} />;
}
