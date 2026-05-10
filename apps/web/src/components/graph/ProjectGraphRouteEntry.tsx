"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";
import { useShellLabels } from "@/components/shell/shell-labels";
import { ProjectGraphLoader } from "./ProjectGraphLoader";

interface Props {
  wsSlug: string;
  projectId: string;
}

/**
 * Entry component rendered by the /w/<slug>/p/<id>/graph server page.
 * On mount, ensures a `(kind='project', mode='graph', targetId=projectId)`
 * tab exists and is active — same pattern as the dashboard / research_hub
 * routes use to sync URL → tab store.
 */
export function ProjectGraphRouteEntry({ projectId }: Props) {
  const findTabByTarget = useTabsStore((s) => s.findTabByTarget);
  const addTab = useTabsStore((s) => s.addTab);
  const setActive = useTabsStore((s) => s.setActive);
  const updateTab = useTabsStore((s) => s.updateTab);
  const { tabs: labels } = useShellLabels();

  useEffect(() => {
    const existing = findTabByTarget("project", projectId);
    if (existing) {
      if (existing.mode !== "graph") {
        updateTab(existing.id, {
          mode: "graph",
          title: labels.titles.graph,
          titleKey: "appShell.tabTitles.graph",
        });
      }
      setActive(existing.id);
      return;
    }
    addTab({
      id: crypto.randomUUID(),
      kind: "project",
      targetId: projectId,
      mode: "graph",
      title: labels.titles.graph,
      titleKey: "appShell.tabTitles.graph",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }, [projectId, findTabByTarget, addTab, setActive, updateTab, labels]);

  return <ProjectGraphLoader projectId={projectId} />;
}
