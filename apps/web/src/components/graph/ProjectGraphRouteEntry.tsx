"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";
import { ProjectGraph } from "./ProjectGraph";

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

  useEffect(() => {
    const existing = findTabByTarget("project", projectId);
    if (existing && existing.mode === "graph") {
      setActive(existing.id);
      return;
    }
    addTab({
      id: crypto.randomUUID(),
      kind: "project",
      targetId: projectId,
      mode: "graph",
      title: "Graph",
      titleKey: "appShell.tabTitles.graph",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }, [projectId, findTabByTarget, addTab, setActive]);

  return <ProjectGraph projectId={projectId} />;
}
