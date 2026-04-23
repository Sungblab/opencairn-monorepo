import { useTranslations } from "next-intl";

export default async function ResearchRunPlaceholder({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ResearchRunBody runId={runId} />;
}

function ResearchRunBody({ runId }: { runId: string }) {
  const t = useTranslations("appShell.routes.research_run");
  return (
    <div data-testid="route-research-run" className="p-6">
      <h1 className="text-2xl font-semibold">
        {t("heading", { id: runId })}
      </h1>
      <p className="text-sm text-muted-foreground">{t("placeholder")}</p>
    </div>
  );
}
