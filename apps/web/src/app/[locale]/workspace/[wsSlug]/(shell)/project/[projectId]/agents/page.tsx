import { AgentEntryPointsViewLoader } from "@/components/views/agents/agent-entrypoints-view-loader";

export default async function ProjectAgentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <AgentEntryPointsViewLoader projectId={projectId} />;
}
