import type { Metadata } from "next";
import { ProjectGraphRouteEntry } from "@/components/graph/ProjectGraphRouteEntry";

interface PageProps {
  params: Promise<{ locale: string; wsSlug: string; projectId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: `Graph · ${projectId}` };
}

export default async function ProjectGraphPage({ params }: PageProps) {
  const { wsSlug, projectId } = await params;
  return <ProjectGraphRouteEntry wsSlug={wsSlug} projectId={projectId} />;
}
