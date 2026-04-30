// Plan 2E Phase B — Zod schema for the image Plate element.
//
// `url` must be an http/https URL — data: and javascript: schemes are
// explicitly rejected by the refine so they can never reach the DOM as
// an <img src>. The width field (0.1–1.0) represents a fraction of the
// container width; absent = natural size.
import { z } from "zod";

export const imageElementSchema = z.object({
  type: z.literal("image"),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: "Only http and https URLs are allowed",
    }),
  alt: z.string().max(500).optional(),
  caption: z.string().max(1000).optional(),
  width: z.number().min(0.1).max(1).optional(),
  children: z.tuple([z.object({ text: z.literal("") })]),
});

export type ImageElement = z.infer<typeof imageElementSchema>;
