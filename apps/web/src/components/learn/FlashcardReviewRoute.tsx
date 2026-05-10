"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { urls } from "@/lib/urls";
import { FlashcardReview } from "./FlashcardReview";
import type { FlashcardReviewLabels } from "./flashcard-review-labels";

type Card = { id: string; front: string; back: string };

export type FlashcardReviewRouteProps = {
  locale: string;
  wsSlug: string;
  projectId: string;
  reviewLabels: FlashcardReviewLabels;
};

export function FlashcardReviewRoute({
  locale,
  wsSlug,
  projectId,
  reviewLabels,
}: FlashcardReviewRouteProps) {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/learn/flashcards/due?limit=20`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data: Card[]) => setCards(data))
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  async function handleReview(cardId: string, quality: 1 | 2 | 3 | 4) {
    await fetch(`/api/projects/${projectId}/learn/flashcards/${cardId}/review`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality }),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        {reviewLabels.loading}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">{reviewLabels.noDue}</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-primary underline underline-offset-2"
        >
          {reviewLabels.backToDecks}
        </button>
      </div>
    );
  }

  return (
    <FlashcardReview
      cards={cards}
      labels={reviewLabels}
      onReview={handleReview}
      onComplete={() =>
        router.push(
          urls.workspace.projectLearnFlashcards(locale, wsSlug, projectId),
        )
      }
    />
  );
}
