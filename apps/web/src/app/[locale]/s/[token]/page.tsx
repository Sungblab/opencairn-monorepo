// Plan 2C Task 8 — `/[locale]/s/[token]` public-share SSR page.
//
// Routing-wise this lives under `[locale]/` (not `[locale]/app/`), so it
// inherits ONLY the locale-root layout (NextIntlClientProvider + Toaster) —
// no auth guard. There is no `middleware.ts` in this codebase; auth is
// enforced per route group via layouts (e.g., `(shell)/layout.tsx`).
//
// Security:
//   - `robots: { index: false, follow: false }` — share URLs must never end
//     up in search indices. Combined with `meta name="robots"` the search
//     engines that respect either signal will skip the page.
//   - `referrer: "no-referrer"` — outbound clicks from the viewer (e.g., a
//     link in the rendered note) must NOT leak the share token via the
//     `Referer` header. This is the same trick auth flows use.
//
// The `fetchPublicShare` helper sends `credentials: "omit"`, so a logged-in
// visitor's session cookie never reaches the public endpoint. The server
// rate-limits per-IP, so we don't need any client-side throttle.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { PublicNoteView } from "@/components/share/public-note-view";
import { ApiError, fetchPublicShare } from "@/lib/api-client";
import type { Locale } from "@/i18n";

// Always render this on each request — share-link state (revoked/not) is
// mutable and we don't want a stale 200 to outlive a revoke at the CDN.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);

  let note;
  try {
    note = await fetchPublicShare(token);
  } catch (err) {
    // 404 / 410 / 429 / network failure all collapse to the not-found page —
    // we deliberately don't distinguish revoked vs missing in the UI so
    // attackers can't probe for valid-but-revoked tokens.
    if (err instanceof ApiError) notFound();
    throw err;
  }

  return <PublicNoteView note={note} />;
}
