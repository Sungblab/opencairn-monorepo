// Plan 2E Phase B — Zod schema for the embed Plate element.
//
// `embedUrl` is NEVER user-supplied; it is computed by `toEmbedUrl()` and
// stored alongside the original `url` so the share renderer can use it
// without re-running the transform. On hydration we re-validate: if
// `embedUrl` doesn't match `toEmbedUrl(url)` we recompute (forward-compat).
import { z } from "zod";

export const embedProviderSchema = z.enum(["youtube", "vimeo", "loom"]);
export type EmbedProvider = z.infer<typeof embedProviderSchema>;

export const embedElementSchema = z.object({
  type: z.literal("embed"),
  provider: embedProviderSchema,
  /** Original URL — kept so the user can see what they pasted. */
  url: z.string().url(),
  /** Computed iframe src — never user-supplied. */
  embedUrl: z.string().url(),
  children: z.tuple([z.object({ text: z.literal("") })]),
});

export type EmbedElement = z.infer<typeof embedElementSchema>;
