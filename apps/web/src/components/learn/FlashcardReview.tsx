"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Card = {
  id: string;
  front: string;
  back: string;
};

type FlashcardReviewProps = {
  cards: Card[];
  onReview: (cardId: string, quality: 1 | 2 | 3 | 4) => Promise<void>;
  onComplete: () => void;
};

const QUALITY_KEYS = ["1", "2", "3", "4"] as const;
const QUALITY_COLORS = [
  "bg-destructive text-destructive-foreground",
  "bg-orange-500 text-white",
  "bg-green-500 text-white",
  "bg-blue-500 text-white",
] as const;

export function FlashcardReview({
  cards,
  onReview,
  onComplete,
}: FlashcardReviewProps) {
  const t = useTranslations("learn.review");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const card = cards[index];
  const isLast = index === cards.length - 1;

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-xl font-semibold">{t("session_complete")}</p>
        <button
          onClick={onComplete}
          className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          {t("done")}
        </button>
      </div>
    );
  }

  async function handleRating(quality: 1 | 2 | 3 | 4) {
    setReviewing(true);
    await onReview(card.id, quality);
    setReviewing(false);
    setFlipped(false);
    if (isLast) {
      onComplete();
    } else {
      setIndex((i) => i + 1);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 max-w-2xl mx-auto">
      <p className="text-sm text-muted-foreground">
        {t("card_progress", { current: index + 1, total: cards.length })}
      </p>

      <button
        onClick={() => setFlipped((f) => !f)}
        className="w-full min-h-[220px] rounded-2xl border border-border bg-card shadow-md p-8 text-left transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label={flipped ? t("front") : t("back")}
      >
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          {flipped ? t("back") : t("front")}
        </p>
        <p className="text-lg font-medium text-card-foreground whitespace-pre-wrap">
          {flipped ? card.back : card.front}
        </p>
      </button>

      {!flipped ? (
        <button
          onClick={() => setFlipped(true)}
          className="px-8 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          {t("reveal")}
        </button>
      ) : (
        <div className="flex gap-3 w-full">
          {QUALITY_KEYS.map((key, i) => (
            <button
              key={key}
              disabled={reviewing}
              onClick={() => handleRating(Number(key) as 1 | 2 | 3 | 4)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-opacity ${QUALITY_COLORS[i]} disabled:opacity-50`}
            >
              {t(`quality.${key}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
