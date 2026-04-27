"use client";

import { useTranslations } from "next-intl";

// Plan 11A — per-message cost display. Format defaults to KRW because the
// API ships in KRW; locale-aware formatting can be re-derived later from
// the user's currency preference. Sub-1원 amounts keep two decimals so a
// usable signal remains; large amounts round to a clean integer.
export function CostBadge({ costKrw }: { costKrw: number }): JSX.Element {
  const t = useTranslations("chatScope.cost");
  const formatted = costKrw < 1 ? `${costKrw.toFixed(2)}원` : `${Math.round(costKrw)}원`;
  return (
    <span
      className="ml-2 text-xs text-stone-500"
      aria-label={t("badge_aria")}
      title={t("badge_title", { cost: costKrw.toFixed(4) })}
    >
      −{formatted}
    </span>
  );
}
