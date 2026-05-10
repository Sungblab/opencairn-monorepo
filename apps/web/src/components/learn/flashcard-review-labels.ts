export const FLASHCARD_QUALITY_KEYS = ["1", "2", "3", "4"] as const;

export type FlashcardQualityKey = (typeof FLASHCARD_QUALITY_KEYS)[number];

export type FlashcardReviewLabels = {
  cardProgress: string;
  front: string;
  back: string;
  reveal: string;
  sessionComplete: string;
  done: string;
  noDue: string;
  backToDecks: string;
  loading: string;
  quality: Record<FlashcardQualityKey, string>;
};

export function formatFlashcardProgress(
  template: string,
  current: number,
  total: number,
) {
  return template
    .replace("{current}", String(current))
    .replace("{total}", String(total));
}
