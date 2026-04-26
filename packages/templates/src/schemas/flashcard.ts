import { z } from "zod";

export const flashcardSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().max(2000),
        back: z.string().max(4000),
        tags: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(50),
});
export type FlashcardOutput = z.infer<typeof flashcardSchema>;
