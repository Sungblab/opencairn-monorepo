"use client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import type { Tab } from "@/stores/tabs-store";

export function DataViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.data");
  const { data, isLoading } = useQuery<{ data: unknown }>({
    queryKey: ["note-data", tab.targetId],
    enabled: !!tab.targetId,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${tab.targetId}/data`);
      if (!r.ok) throw new Error(`data ${r.status}`);
      return (await r.json()) as { data: unknown };
    },
  });

  if (!tab.targetId) return null;

  return (
    <div data-testid="data-viewer" className="h-full overflow-auto p-4 text-sm">
      {isLoading ? (
        <p className="text-muted-foreground">…</p>
      ) : data?.data == null ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <JsonView data={data.data as object} style={defaultStyles} />
      )}
    </div>
  );
}
