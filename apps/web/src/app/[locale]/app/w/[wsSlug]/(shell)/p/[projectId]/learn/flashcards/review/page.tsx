"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FlashcardReview } from "@/components/learn/FlashcardReview";

type Card = { id: string; front: string; back: string };

export default function ReviewPage() {
  const { wsSlug, projectId } = useParams<{
    wsSlug: string;
    projectId: string;
  }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("learn.review");
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
        {t("loading")}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <p className="text-muted-foreground">{t("no_due")}</p>
        <button
          onClick={() => router.back()}
          className="text-sm text-primary underline underline-offset-2"
        >
          {t("back_to_decks")}
        </button>
      </div>
    );
  }

  return (
    <FlashcardReview
      cards={cards}
      onReview={handleReview}
      onComplete={() =>
        router.push(`/${locale}/app/w/${wsSlug}/p/${projectId}/learn/flashcards`)
      }
    />
  );
}
