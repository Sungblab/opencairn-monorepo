import { getTranslations } from "next-intl/server";
import { apiClient } from "@/lib/api-client";
import { DeckCard } from "@/components/learn/DeckCard";

interface FlashcardRow {
  id: string;
  deckName: string;
  nextReview: string;
}

async function getDecks(projectId: string) {
  try {
    const cards = await apiClient<FlashcardRow[]>(
      `/api/projects/${projectId}/learn/flashcards`,
    );
    const now = new Date();
    const deckMap = new Map<string, { total: number; due: number }>();
    for (const card of cards) {
      const entry = deckMap.get(card.deckName) ?? { total: 0, due: 0 };
      entry.total += 1;
      if (new Date(card.nextReview) <= now) entry.due += 1;
      deckMap.set(card.deckName, entry);
    }
    return Array.from(deckMap.entries()).map(([name, stats]) => ({
      deckName: name,
      ...stats,
    }));
  } catch {
    return [];
  }
}

export default async function FlashcardsPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projectId: string }>;
}) {
  const { wsSlug, projectId } = await params;
  const t = await getTranslations("learn.flashcards");
  const decks = await getDecks(projectId);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("title")}</h1>
      {decks.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.deckName}
              deckName={deck.deckName}
              totalCards={deck.total}
              dueCount={deck.due}
              reviewHref={`/app/w/${wsSlug}/p/${projectId}/learn/flashcards/review`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
