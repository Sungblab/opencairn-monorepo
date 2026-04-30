"use client";

// Sidebar-driven literature search modal. Calls the same backend that the
// chat-bubble + tab-shell viewer use:
//   GET  /api/literature/search?q&workspaceId&limit
//   POST /api/literature/import { ids, projectId }
//
// The tab-shell viewer (apps/web/src/components/tab-shell/viewers/lit-search-viewer.tsx)
// is the agent-driven path — it lights up when the chat agent calls
// `literature_search` and dispatches a tab. This modal is the *user*-driven
// entry point: a button in the sidebar opens it directly so the user can
// search and import without touching the agent. Shared types live in
// apps/web/src/stores/lit-search-store.ts.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LitPaperPayload } from "@/stores/lit-search-store";

interface ProjectOption {
  id: string;
  name: string;
}

interface SearchResponse {
  results: LitPaperPayload[];
  total: number;
}

interface ImportResponse {
  jobId: string | null;
  workflowId: string | null;
  skipped: string[];
  queued: number;
}

export interface LiteratureSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for the search call; null disables the form with a hint. */
  workspaceId: string | null;
  /** Pre-selected destination project. User can still change it. */
  defaultProjectId?: string | null;
}

export function LiteratureSearchModal({
  open,
  onOpenChange,
  workspaceId,
  defaultProjectId,
}: LiteratureSearchModalProps) {
  const t = useTranslations("literature");

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [importDone, setImportDone] = useState<{
    queued: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["literature-projects", workspaceId],
    enabled: open && Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectOption[]> => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`projects ${res.status}`);
      return (await res.json()) as ProjectOption[];
    },
  });

  // Reset transient state every time the modal re-opens. Without this the
  // user reopens the modal and sees stale results / lingering errors.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setImportDone(null);
      setError(null);
      setSubmittedQuery("");
      setQuery("");
      setProjectId(defaultProjectId ?? "");
    }
  }, [open, defaultProjectId]);

  // Auto-pick first project once the list arrives if the parent didn't
  // supply a default. Single-project workspaces would otherwise force an
  // extra click.
  useEffect(() => {
    if (open && !projectId && projectsQ.data && projectsQ.data.length > 0) {
      setProjectId(projectsQ.data[0].id);
    }
  }, [open, projectId, projectsQ.data]);

  const searchM = useMutation({
    mutationFn: async (q: string): Promise<SearchResponse> => {
      if (!workspaceId) throw new Error("missing workspaceId");
      const url = `/api/literature/search?q=${encodeURIComponent(
        q,
      )}&workspaceId=${workspaceId}&limit=20`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`search ${res.status}`);
      return (await res.json()) as SearchResponse;
    },
    onSuccess: () => {
      setSelected(new Set());
      setImportDone(null);
    },
    onError: () => setError(t("search.error")),
  });

  const importM = useMutation({
    mutationFn: async (payload: {
      ids: string[];
      projectId: string;
    }): Promise<ImportResponse> => {
      const res = await fetch("/api/literature/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`import ${res.status}`);
      return (await res.json()) as ImportResponse;
    },
    onSuccess: (data) => {
      setImportDone({ queued: data.queued, skipped: data.skipped.length });
      setSelected(new Set());
    },
    onError: () => setError(t("modal.importError")),
  });

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || !workspaceId) return;
    setSubmittedQuery(trimmed);
    setError(null);
    searchM.mutate(trimmed);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onImport() {
    if (!projectId) {
      setError(t("modal.missingProject"));
      return;
    }
    if (selected.size === 0) return;
    setError(null);
    importM.mutate({ ids: Array.from(selected), projectId });
  }

  const papers = useMemo<LitPaperPayload[]>(
    () => searchM.data?.results ?? [],
    [searchM.data],
  );
  const projects = projectsQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("modal.title")}</DialogTitle>
          <DialogDescription>{t("modal.subtitle")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmitSearch} className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            data-testid="lit-modal-input"
            className="flex-1 rounded border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            disabled={
              searchM.isPending ||
              !workspaceId ||
              query.trim().length === 0
            }
            data-testid="lit-modal-search"
          >
            {searchM.isPending ? t("search.loading") : t("search.button")}
          </Button>
        </form>

        <div className="min-h-[200px] flex-1 overflow-y-auto rounded border border-border">
          {!workspaceId ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("modal.missingWorkspace")}
            </p>
          ) : !submittedQuery ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("modal.emptyHint")}
            </p>
          ) : searchM.isPending ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("search.loading")}
            </p>
          ) : papers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("search.noResults")}
            </p>
          ) : (
            <ul data-testid="lit-modal-results">
              {papers.map((paper) => (
                <li
                  key={paper.id}
                  className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-accent/5"
                  onClick={() => toggle(paper.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(paper.id)}
                    onChange={() => toggle(paper.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={paper.title}
                    className="mt-1 accent-primary"
                    data-testid={`lit-modal-row-${paper.id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-foreground">
                      {paper.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {paper.authors.slice(0, 3).join(", ")}
                      {paper.authors.length > 3 ? " et al." : ""}
                      {paper.year ? ` · ${paper.year}` : ""}
                      {paper.citationCount != null
                        ? ` · ${t("result.citations", {
                            count: paper.citationCount,
                          })}`
                        : ""}
                    </p>
                    {paper.abstract && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {paper.abstract}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {paper.openAccessPdfUrl ? (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        {t("badge.openAccess")}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        {t("badge.paywalled")}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {importDone && (
          <p
            className="text-xs text-green-600 dark:text-green-400"
            data-testid="lit-modal-import-success"
          >
            {t("modal.queued", { count: importDone.queued })}
            {importDone.skipped > 0
              ? ` · ${t("import.skipped", { count: importDone.skipped })}`
              : ""}
          </p>
        )}

        {error && (
          <p
            className="text-xs text-red-600 dark:text-red-400"
            role="alert"
            data-testid="lit-modal-error"
          >
            {error}
          </p>
        )}

        {projectsQ.isError && !error && (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {t("modal.loadProjectsError")}
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            {t("import.selected", { count: selected.size })}
          </span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!workspaceId || projectsQ.isLoading}
            aria-label={t("import.selectProject")}
            data-testid="lit-modal-project"
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">
              {projectsQ.isLoading
                ? t("search.loading")
                : t("import.selectProject")}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            onClick={onImport}
            disabled={
              selected.size === 0 || !projectId || importM.isPending
            }
            data-testid="lit-modal-import"
          >
            {importM.isPending ? t("import.importing") : t("import.button")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
