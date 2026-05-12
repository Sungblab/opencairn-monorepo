// Plan 2C Task 8 — page shell for `/[locale]/s/[token]`.
//
// Wraps the read-only `PlateStaticRenderer` with a top banner ("View only" +
// sign-in CTA) and the note title. Stays a server component — no client
// interactivity needed for the v1 viewer.
//
// Auth status is intentionally NOT checked here. If the visitor is signed in,
// they still see the public viewer (the share-link token, not their session,
// is what authorises access). Linking them off to `/auth/login` is a passive
// CTA, not a redirect.

import { useTranslations } from "next-intl";

import { PlateStaticRenderer } from "./plate-static-renderer";
import type { PublicShareNote } from "@/lib/api-client";
import { siteConfig } from "@/lib/site-config";

export function PublicNoteView({ note }: { note: PublicShareNote }) {
  const t = useTranslations("publicShare");

  return (
    <div
      className="min-h-screen bg-background"
      data-testid="public-share-reader"
    >
      {/* View-only banner. `border-b` keeps the chrome distinct from the
          note body so visitors immediately understand they're on a shared
          page, not the editor. */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">
              {siteConfig.name}
            </p>
            <div className="mt-0.5 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span
                className="inline-block h-2 w-2 rounded-full bg-emerald-500"
                aria-hidden
              />
              {t("viewOnly")}
            </div>
          </div>
          <a
            href="/"
            className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t("signInCta")}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <article className="max-w-3xl" data-testid="public-share-article">
          <header className="mb-8 border-b border-border pb-6">
            <h1 className="text-4xl font-semibold tracking-tight">
            {note.title || t("viewOnly")}
            </h1>
            <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("sharedBy")}
            </p>
          </header>
          <PlateStaticRenderer value={note.plateValue} />
        </article>
      </main>
    </div>
  );
}
