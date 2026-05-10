// Plan 2C Task 8 — not-found shell for `/s/[token]`.
//
// Rendered when `fetchPublicShare` throws `ApiError` (404/410/429) — see
// `page.tsx`. We intentionally collapse all failure modes into one screen
// so attackers can't probe for the existence of revoked tokens.

import { useTranslations } from "next-intl";

export default function ShareNotFound() {
  const t = useTranslations("publicShare");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="mb-6 text-sm text-muted-foreground">{t("notFound")}</p>
        <a
          href="/"
          className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          {t("signInCta")}
        </a>
      </div>
    </main>
  );
}
