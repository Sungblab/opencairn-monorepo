"use client";
import { useLocale, useTranslations } from "next-intl";
import { Workflow } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { useCurrentProjectContext } from "./use-current-project";
import { urls } from "@/lib/urls";

export function ProjectGraphLink() {
  const t = useTranslations("sidebar.graph");
  const locale = useLocale();
  const { projectId } = useCurrentProjectContext();
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;
  const addTab = useTabsStore((s) => s.addTab);

  if (!projectId) return null;

  function open() {
    if (!projectId || !wsSlug) return; // narrowing for TS — early return above guarantees projectId
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
    router.push(urls.workspace.projectGraph(locale, wsSlug, projectId));
  }

  return (
    <button
      type="button"
      onClick={open}
      className="mx-3 my-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("entry")}</span>
    </button>
  );
}
