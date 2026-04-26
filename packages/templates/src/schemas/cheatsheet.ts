import { z } from "zod";

export const cheatsheetSchema = z.object({
  title: z.string(),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        items: z.array(
          z.object({
            term: z.string(),
            definition: z.string(),
            example: z.string().optional(),
          }),
        ),
      }),
    )
    .min(1),
});
export type CheatsheetOutput = z.infer<typeof cheatsheetSchema>;
