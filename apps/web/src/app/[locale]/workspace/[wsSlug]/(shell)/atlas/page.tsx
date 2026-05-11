import type { Metadata } from "next";
import { WorkspaceAtlasView } from "@/components/views/workspace-atlas/workspace-atlas-view";

interface PageProps {
  params: Promise<{ wsSlug: string }>;
}

export const metadata: Metadata = {
  title: "Ontology Atlas",
};

export default async function WorkspaceAtlasPage({ params }: PageProps) {
  const { wsSlug } = await params;
  return <WorkspaceAtlasView wsSlug={wsSlug} />;
}
