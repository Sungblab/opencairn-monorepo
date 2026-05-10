import { notFound } from "next/navigation";
import { isDeepResearchEnabled } from "@/lib/feature-flags";
import { ResearchRunViewLoader } from "@/components/research/ResearchRunViewLoader";

export default async function ResearchRunPage({
  params,
}: {
  params: Promise<{ wsSlug: string; runId: string }>;
}) {
  if (!isDeepResearchEnabled()) notFound();
  const { wsSlug, runId } = await params;
  return <ResearchRunViewLoader runId={runId} wsSlug={wsSlug} />;
}
