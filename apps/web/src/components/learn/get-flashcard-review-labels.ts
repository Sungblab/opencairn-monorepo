import { getTranslations } from "next-intl/server";
import {
  FLASHCARD_QUALITY_KEYS,
  type FlashcardReviewLabels,
} from "./flashcard-review-labels";

export async function getFlashcardReviewLabels(): Promise<FlashcardReviewLabels> {
  const t = await getTranslations("learn.review");

  return {
    cardProgress: t("card_progress", { current: "{current}", total: "{total}" }),
    front: t("front"),
    back: t("back"),
    reveal: t("reveal"),
    sessionComplete: t("session_complete"),
    done: t("done"),
    noDue: t("no_due"),
    backToDecks: t("back_to_decks"),
    loading: t("loading"),
    quality: Object.fromEntries(
      FLASHCARD_QUALITY_KEYS.map((key) => [key, t(`quality.${key}`)]),
    ) as FlashcardReviewLabels["quality"],
  };
}
