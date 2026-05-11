"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Home, FlaskConical } from "lucide-react";
import { LiteratureSearchButton } from "@/components/literature/literature-search-button";

export interface GlobalNavProps {
  wsSlug: string;
  deepResearchEnabled: boolean;
}

// Workspace-level navigation. Keep destinations visible as text; icon-only
// rails are compact but too opaque for first-run workspace UX.
//
// `deepResearchEnabled` mirrors the API-side gate at
// apps/api/src/routes/research.ts:52. When the flag is off the route 404s,
// so the icon must not appear in the rail.
export function GlobalNav({
  wsSlug,
  deepResearchEnabled,
}: GlobalNavProps) {
  const locale = useLocale();
  const t = useTranslations("sidebar.nav");
  const base = urls.workspace.root(locale, wsSlug);

  const items = [
    { href: `${base}/`, label: t("dashboard"), Icon: Home },
    ...(deepResearchEnabled
      ? [
          {
            href: `${base}/research`,
            label: t("research"),
            Icon: FlaskConical,
          } as const,
        ]
      : []),
  ] as const;

  return (
    <nav
      aria-label={t("dashboard")}
      className="mx-3 grid gap-0.5 border-y border-border py-2"
    >
      {items.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-8 items-center gap-2 border-l-2 border-transparent px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon aria-hidden className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
      ))}
      <LiteratureSearchButton wsSlug={wsSlug} />
    </nav>
  );
}
