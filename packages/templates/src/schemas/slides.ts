import { z } from "zod";

export const slidesSchema = z.object({
  title: z.string(),
  slides: z
    .array(
      z.object({
        heading: z.string(),
        bullets: z.array(z.string()).max(6),
        speaker_notes: z.string().optional(),
        layout: z
          .enum(["title", "bullets", "two-column", "image-text"])
          .default("bullets"),
      }),
    )
    .min(1)
    .max(30),
  react_component_hint: z.string().optional(),
});
export type SlidesOutput = z.infer<typeof slidesSchema>;
