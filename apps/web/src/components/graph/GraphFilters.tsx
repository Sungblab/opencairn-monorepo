"use client";
import { useTranslations } from "next-intl";
import type { FilterState } from "./graph-types";

interface Props {
  filters: FilterState;
  relations: string[];
  truncated: boolean;
  shown: number;
  total: number;
  onChange(next: Partial<FilterState>): void;
}

export function GraphFilters({ filters, relations, truncated, shown, total, onChange }: Props) {
  const t = useTranslations("graph.filters");
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
      <input
        type="search"
        placeholder={t("searchPlaceholder")}
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        className="flex-1 min-w-[180px] rounded border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {t("relationLabel")}
        <select
          value={filters.relation ?? ""}
          onChange={(e) => onChange({ relation: e.target.value || null })}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">{t("relationAll")}</option>
          {relations.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      {truncated && (
        <span className="text-xs text-muted-foreground">
          {t("truncatedBanner", { shown, total })}
        </span>
      )}
    </div>
  );
}
