"use client";

import { DeckCard } from "./DeckCard";

export type FlashcardDeckRow = {
  deckName: string;
  total: number;
  due: number;
};

export type FlashcardDeckGridProps = {
  decks: FlashcardDeckRow[];
  reviewHref: string;
};

export function FlashcardDeckGrid({
  decks,
  reviewHref,
}: FlashcardDeckGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => (
        <DeckCard
          key={deck.deckName}
          deckName={deck.deckName}
          totalCards={deck.total}
          dueCount={deck.due}
          reviewHref={reviewHref}
        />
      ))}
    </div>
  );
}
