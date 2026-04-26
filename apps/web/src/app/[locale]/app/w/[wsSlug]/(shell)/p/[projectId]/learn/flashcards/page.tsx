import { getTranslations } from "next-intl/server";
import { apiClient } from "@/lib/api-client";
import { DeckCard } from "@/components/learn/DeckCard";

interface DeckRow {
  deckName: string;
  total: number;
  due: number;
}

async function getDecks(projectId: string): Promise<DeckRow[]> {
  try {
    return await apiClient<DeckRow[]>(
      `/api/projects/${projectId}/learn/decks`,
    );
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
