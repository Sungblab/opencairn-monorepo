"use client";

import { useTranslations } from "next-intl";

export interface TokenBudgetBarProps {
  used: number;
  budget: number;
}

export function TokenBudgetBar({ used, budget }: TokenBudgetBarProps) {
  const t = useTranslations("synthesisExport");

  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 100;
  const exceeded = used > budget;

  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full transition-all ${exceeded ? "bg-red-500" : "bg-neutral-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-neutral-500">
        {t("token.estimated", {
          used: used.toLocaleString(),
          budget: budget.toLocaleString(),
        })}
      </p>
      {exceeded && (
        <p className="text-xs text-red-500">{t("token.exceeded")}</p>
      )}
    </div>
  );
}
