"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { searchApi } from "@/lib/api-client";

export interface PickedSource {
  id: string;
  title: string;
  kind: "s3_object" | "note" | "dr_result";
}

interface Props {
  workspaceId: string;
  sources: PickedSource[];
  autoSearch: boolean;
  onAddSource: (source: PickedSource) => void;
  onRemoveSource: (id: string) => void;
  onAutoSearchChange: (v: boolean) => void;
}

export function SourcePicker({
  workspaceId,
  sources,
  autoSearch,
  onAddSource,
  onRemoveSource,
  onAutoSearchChange,
}: Props) {
  const t = useTranslations("synthesisExport");
  const [query, setQuery] = useState("");
  const { data } = useQuery({
    queryKey: ["synthesis-source-search", workspaceId, query],
    enabled: query.trim().length > 0,
    staleTime: 15_000,
    queryFn: () => searchApi.workspaceNotes(workspaceId, query.trim(), 8),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">
          {t("panel.sources", { count: sources.length })}
        </span>
      </div>

      <div className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
        <input
          data-testid="synthesis-source-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("sources.searchPlaceholder")}
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        {(data?.results ?? []).length > 0 && (
          <ul className="mt-2 max-h-44 overflow-auto">
            {data!.results.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() =>
                    onAddSource({
                      id: hit.id,
                      title: hit.title,
                      kind: "note",
                    })
                  }
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="truncate">{hit.title}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {hit.project_name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {sources.map((src) => (
          <li
            key={src.id}
            className="flex items-center justify-between rounded border border-neutral-200 px-2 py-1 text-sm dark:border-neutral-700"
          >
            <span className="truncate">{src.title}</span>
            <button
              type="button"
              aria-label={t("sources.remove")}
              onClick={() => onRemoveSource(src.id)}
              className="ml-2 shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={autoSearch}
          onChange={(e) => onAutoSearchChange(e.target.checked)}
          className="rounded"
        />
        {t("panel.autoSearch")}
      </label>
      <p className="text-xs text-neutral-500">{t("sources.drResultPolicy")}</p>
    </div>
  );
}
