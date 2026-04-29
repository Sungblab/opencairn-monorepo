"use client";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Home, FlaskConical, DownloadCloud } from "lucide-react";
import { MoreMenu } from "./more-menu";

export interface GlobalNavProps {
  wsSlug: string;
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

// Icon rail that sits at the top of the sidebar. Links go to workspace-scoped
// routes; the overflow popover carries secondary destinations that would
// otherwise push this row past the sidebar width.
//
// `deepResearchEnabled` mirrors the API-side gate at
// apps/api/src/routes/research.ts:52. When the flag is off the route 404s,
// so the icon must not appear in the rail.
export function GlobalNav({
  wsSlug,
  deepResearchEnabled,
  synthesisExportEnabled = false,
}: GlobalNavProps) {
  const locale = useLocale();
  const t = useTranslations("sidebar.nav");
  const base = `/${locale}/app/w/${wsSlug}`;

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
    { href: `${base}/import`, label: t("import"), Icon: DownloadCloud },
  ] as const;

  return (
    <nav
      aria-label={t("dashboard")}
      className="flex items-center gap-1 border-b border-border px-2 py-1"
    >
      {items.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          title={label}
          aria-label={label}
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
        >
          <Icon aria-hidden className="h-4 w-4" />
        </Link>
      ))}
      <MoreMenu base={base} synthesisExportEnabled={synthesisExportEnabled} />
    </nav>
  );
}
