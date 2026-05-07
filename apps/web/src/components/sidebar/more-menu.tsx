"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, Settings, Share2, Trash2 } from "lucide-react";

export interface MoreMenuProps {
  base: string;
  synthesisExportEnabled?: boolean;
}

// Overflow popover for the sidebar's global nav. Link-rendered items keep
// native browser affordances such as Cmd/Ctrl-click and copy-link.
//
// `synthesisExportEnabled` mirrors the API gate at
// apps/api/src/routes/synthesis-export.ts; when the server flag is off
// the route 404s, so the menu item must not appear.
export function MoreMenu({ base, synthesisExportEnabled = false }: MoreMenuProps) {
  const t = useTranslations("sidebar");
  const primaryItems = [
    {
      href: `${base}/settings`,
      label: t("more_menu.settings"),
      Icon: Settings,
    },
    {
      href: `${base}/settings/shared-links`,
      label: t("more_menu.shared_links"),
      Icon: Share2,
    },
    ...(synthesisExportEnabled
      ? [
          {
            href: `${base}/synthesis-export`,
            label: t("more_menu.synthesis_export"),
            Icon: ExternalLink,
          } as const,
        ]
      : []),
    {
      href: `${base}/settings/trash`,
      label: t("more_menu.trash"),
      Icon: Trash2,
    },
  ] as const;

  return (
    <div className="border-t border-border pt-1.5">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("nav.more_aria")}
      </p>
      <div className="grid gap-1">
        {primaryItems.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
          >
            <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </Link>
        ))}
        <a
          href="/feedback"
          target="_blank"
          rel="noreferrer"
          className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("more_menu.feedback")}
          </span>
        </a>
        <a
          href="/changelog"
          target="_blank"
          rel="noreferrer"
          className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none"
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t("more_menu.changelog")}
          </span>
        </a>
      </div>
    </div>
  );
}
