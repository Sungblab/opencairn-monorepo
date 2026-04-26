"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

type DeckCardProps = {
  deckName: string;
  totalCards: number;
  dueCount: number;
  reviewHref: string;
};

export function DeckCard({
  deckName,
  totalCards,
  dueCount,
  reviewHref,
}: DeckCardProps) {
  const t = useTranslations("learn.flashcards");

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-base text-card-foreground truncate">
          {deckName}
        </h3>
        {dueCount > 0 && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0 ml-2">
            {dueCount} {t("due")}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {totalCards} {t("cards_total")}
      </p>
      <Link
        href={reviewHref}
        className="mt-auto inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {dueCount > 0 ? t("review_now") : t("browse")}
      </Link>
    </div>
  );
}
