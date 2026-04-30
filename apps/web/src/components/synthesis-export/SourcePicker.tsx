"use client";

import { useTranslations } from "next-intl";

export interface PickedSource {
  id: string;
  title: string;
  kind: "s3_object" | "note" | "dr_result";
}

interface Props {
  sources: PickedSource[];
  autoSearch: boolean;
  onAddSource?: () => void;
  onRemoveSource: (id: string) => void;
  onAutoSearchChange: (v: boolean) => void;
}

export function SourcePicker({
  sources,
  autoSearch,
  onAddSource,
  onRemoveSource,
  onAutoSearchChange,
}: Props) {
  const t = useTranslations("synthesisExport");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500">
          {t("panel.sources", { count: sources.length })}
        </span>
        {onAddSource && (
          <button
            type="button"
            onClick={onAddSource}
            className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("sources.add")}
          </button>
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
    </div>
  );
}
