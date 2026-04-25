"use client";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import { ProjectGraph } from "@/components/graph/ProjectGraph";

export function ProjectGraphViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("graph.viewer");
  if (!tab.targetId) {
    return (
      <div
        data-testid="project-graph-viewer-missing"
        className="p-6 text-sm text-muted-foreground"
      >
        {t("missing")}
      </div>
    );
  }
  return (
    <div data-testid="project-graph-viewer" className="h-full">
      <ProjectGraph projectId={tab.targetId} />
    </div>
  );
}
