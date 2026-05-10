import { getTranslations } from "next-intl/server";
import { apiClient } from "@/lib/api-client";
import { FlashcardDeckGridLoader } from "@/components/learn/FlashcardDeckGridLoader";
import { urls } from "@/lib/urls";

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
  params: Promise<{ locale: string; wsSlug: string; projectId: string }>;
}) {
  const { locale, wsSlug, projectId } = await params;
  const t = await getTranslations("learn.flashcards");
  const decks = await getDecks(projectId);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("title")}</h1>
      {decks.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <FlashcardDeckGridLoader
          decks={decks}
          reviewHref={urls.workspace.projectLearnFlashcardsReview(
            locale,
            wsSlug,
            projectId,
          )}
        />
      )}
    </div>
  );
}
