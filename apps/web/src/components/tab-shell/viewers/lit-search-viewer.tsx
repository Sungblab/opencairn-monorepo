"use client";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";
import {
  useLitSearchStore,
  type LitPaperPayload,
} from "@/stores/lit-search-store";

// Full-page viewer for the chat-driven literature search. The chat-side
// LitResultCard stashes the initial payload in lit-search-store keyed by
// the new tab id; this viewer reads it on mount and lets the user re-query,
// select rows, and dispatch an import.

interface LitSearchViewerProps {
  tab: Tab;
}

interface ProjectOption {
  id: string;
  name: string;
}

export function LitSearchViewer({ tab }: LitSearchViewerProps) {
  const t = useTranslations("literature");
  const seed = useLitSearchStore((s) => s.byTabId[tab.id] ?? null);

  const [query, setQuery] = useState(seed?.query ?? "");
  const [papers, setPapers] = useState<LitPaperPayload[]>(seed?.papers ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [projectId, setProjectId] = useState(seed?.projectId ?? "");
  const [skippedCount, setSkippedCount] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const workspaceId = seed?.workspaceId ?? null;
  const { data: projects } = useQuery({
    queryKey: ["projects", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectOption[]> => {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`projects ${res.status}`);
      return (await res.json()) as ProjectOption[];
    },
  });

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !workspaceId) return;
    setLoading(true);
    setImportDone(false);
    try {
      const res = await fetch(
        `/api/literature/search?q=${encodeURIComponent(query)}&workspaceId=${workspaceId}&limit=50`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = (await res.json()) as { results: LitPaperPayload[] };
        setPapers(data.results);
        setSelected(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, [query, workspaceId]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0 || !projectId) return;
    setImporting(true);
    try {
      const res = await fetch("/api/literature/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected), projectId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { skipped: string[]; queued: number };
        setSkippedCount(data.skipped.length);
        setImportDone(true);
        setSelected(new Set());
      }
    } finally {
      setImporting(false);
    }
  };

  // No seed payload + no workspace → the user landed on a stale tab from a
  // previous session (lit-search-store is in-memory, not persisted). Show a
  // gentle empty state rather than a silent broken page.
  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("search.noResults")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("search.placeholder")}
          className="flex-1 bg-background border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? t("search.loading") : t("search.button")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {papers.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            {t("search.noResults")}
          </p>
        )}
        {papers.map((paper) => (
          <div
            key={paper.id}
            className="flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-accent/5 cursor-pointer"
            onClick={() => toggleSelect(paper.id)}
          >
            <input
              type="checkbox"
              checked={selected.has(paper.id)}
              onChange={() => toggleSelect(paper.id)}
              className="mt-1 accent-primary"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-1">
                {paper.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {paper.authors.slice(0, 3).join(", ")}
                {paper.authors.length > 3 ? " et al." : ""}
                {paper.year ? ` · ${paper.year}` : ""}
                {paper.citationCount != null
                  ? ` · ${t("result.citations", { count: paper.citationCount })}`
                  : ""}
              </p>
              {paper.abstract && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {paper.abstract}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {paper.openAccessPdfUrl ? (
                <>
                  <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                    {t("badge.openAccess")}
                  </span>
                  <a
                    href={paper.openAccessPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t("result.openPdf")}
                  </a>
                </>
              ) : (
                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                  {t("badge.paywalled")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border flex items-center gap-3">
        {importDone && skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("import.skipped", { count: skippedCount })}
          </p>
        )}
        {importDone && skippedCount === 0 && (
          <p className="text-xs text-green-600 dark:text-green-400">
            {t("import.done")}
          </p>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {t("import.selected", { count: selected.size })}
        </span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-52 bg-background border border-input rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("import.selectProject")}</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleImport}
          disabled={selected.size === 0 || !projectId || importing}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {importing ? t("import.importing") : t("import.button")}
        </button>
      </div>
    </div>
  );
}
