"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { researchApi, researchKeys } from "@/lib/api-client-research";
import { NewResearchDialog } from "./NewResearchDialog";

export interface ResearchHubProps {
  wsSlug: string;
  workspaceId: string;
  projects: { id: string; name: string }[];
  managedEnabled: boolean;
}

export function ResearchHub({
  wsSlug,
  workspaceId,
  projects,
  managedEnabled,
}: ResearchHubProps) {
  const t = useTranslations("research");
  const locale = useLocale();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: researchKeys.list(workspaceId),
    queryFn: () => researchApi.listRuns(workspaceId),
  });

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("hub.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("hub.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm"
        >
          {t("hub.new_button")}
        </button>
      </header>

      {isLoading ? null : !data || data.runs.length === 0 ? (
        <div className="text-muted-foreground rounded border border-dashed border-border p-8 text-center text-sm">
          {t("hub.empty")}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b border-border text-left text-xs">
            <tr>
              <th className="py-2">{t("hub.list.topic")}</th>
              <th>{t("hub.list.model")}</th>
              <th>{t("hub.list.status")}</th>
              <th>{t("hub.list.started_at")}</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr
                key={r.id}
                className="hover:bg-muted/30 cursor-pointer border-b border-border"
                onClick={() =>
                  router.push(`/${locale}/app/w/${wsSlug}/research/${r.id}`)
                }
                data-testid="research-row"
              >
                <td className="py-2">{r.topic}</td>
                <td>
                  {r.model === "deep-research-max-preview-04-2026"
                    ? t("model.deep_research_max")
                    : t("model.deep_research")}
                </td>
                <td>{t(`status.${r.status}`)}</td>
                <td className="text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString(locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewResearchDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(runId) => {
          setDialogOpen(false);
          router.push(`/${locale}/app/w/${wsSlug}/research/${runId}`);
        }}
        workspaceId={workspaceId}
        projects={projects}
        managedEnabled={managedEnabled}
      />
    </div>
  );
}
