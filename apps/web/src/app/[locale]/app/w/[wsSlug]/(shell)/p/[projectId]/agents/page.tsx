import { AgentEntryPointsView } from "@/components/views/agents/agent-entrypoints-view";

export default async function ProjectAgentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <AgentEntryPointsView projectId={projectId} />;
}
