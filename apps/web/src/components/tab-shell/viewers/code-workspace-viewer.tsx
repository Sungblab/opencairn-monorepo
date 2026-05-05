"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileCode, FolderCode } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CodeWorkspaceManifest } from "@opencairn/shared";
import type { Tab } from "@/stores/tabs-store";
import { buttonVariants } from "@/components/ui/button";

interface CodeWorkspaceResponse {
  workspace: {
    id: string;
    name: string;
    currentSnapshotId: string;
  };
  snapshot: {
    id: string;
    manifest: CodeWorkspaceManifest;
  };
}

export function CodeWorkspaceViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("codeWorkspaces.viewer");
  const targetId = tab.targetId;
  const { data, isLoading, isError } = useQuery<CodeWorkspaceResponse>({
    queryKey: ["code-workspace", targetId],
    enabled: Boolean(targetId),
    queryFn: async () => {
      const res = await fetch(`/api/code-workspaces/${targetId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`code-workspace ${res.status}`);
      return (await res.json()) as CodeWorkspaceResponse;
    },
  });

  const counts = useMemo(() => {
    const entries = data?.snapshot.manifest.entries ?? [];
    return {
      files: entries.filter((entry) => entry.kind === "file").length,
      directories: entries.filter((entry) => entry.kind === "directory").length,
    };
  }, [data?.snapshot.manifest.entries]);

  if (!targetId) return null;
  if (isLoading) {
    return <div className="h-full p-4 text-sm text-muted-foreground">{t("loading")}</div>;
  }
  if (isError || !data) {
    return <div className="h-full p-4 text-sm text-destructive">{t("error")}</div>;
  }

  const archiveUrl = `/api/code-workspaces/${data.workspace.id}/snapshots/${data.snapshot.id}/archive`;

  return (
    <div data-testid="code-workspace-viewer" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{data.workspace.name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("meta", counts)}</span>
            <span>{t("currentSnapshot", { id: data.snapshot.id.slice(0, 8) })}</span>
          </div>
        </div>
        <a
          href={archiveUrl}
          aria-label={t("archive")}
          title={t("archive")}
          className={buttonVariants({ size: "sm", variant: "ghost" })}
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="rounded border">
          {data.snapshot.manifest.entries.map((entry) => (
            <div
              key={`${entry.kind}:${entry.path}`}
              className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
            >
              {entry.kind === "directory" ? (
                <FolderCode aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileCode aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.path}</span>
              {entry.kind === "file" ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("bytes", { bytes: entry.bytes.toLocaleString() })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
