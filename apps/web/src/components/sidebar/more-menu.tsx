"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("nav.more_aria")}
        className="app-hover ml-auto flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        <MoreHorizontal aria-hidden className="h-[15px] w-[15px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem render={<Link href={`${base}/settings`} />}>
          {t("more_menu.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href={`${base}/settings/shared-links`} />}
        >
          {t("more_menu.shared_links")}
        </DropdownMenuItem>
        {synthesisExportEnabled ? (
          <DropdownMenuItem render={<Link href={`${base}/synthesis-export`} />}>
            {t("more_menu.synthesis_export")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<Link href={`${base}/settings/trash`} />}>
          {t("more_menu.trash")}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<a href="/feedback" target="_blank" rel="noreferrer" />}
        >
          {t("more_menu.feedback")}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<a href="/changelog" target="_blank" rel="noreferrer" />}
        >
          {t("more_menu.changelog")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
