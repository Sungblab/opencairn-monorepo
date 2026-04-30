import { notFound } from "next/navigation";
import { isDeepResearchEnabled } from "@/lib/feature-flags";
import { ResearchRunView } from "@/components/research/ResearchRunView";

export default async function ResearchRunPage({
  params,
}: {
  params: Promise<{ wsSlug: string; runId: string }>;
}) {
  if (!isDeepResearchEnabled()) notFound();
  const { wsSlug, runId } = await params;
  return <ResearchRunView runId={runId} wsSlug={wsSlug} />;
}
