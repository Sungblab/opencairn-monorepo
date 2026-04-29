"use client";
import { useRouter } from "next/navigation";
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

// Overflow popover for the sidebar's global nav. Items route with
// router.push for workspace-scoped entries and fall through to plain
// window navigation for cross-product destinations (feedback/changelog)
// that may live on a marketing subdomain.
//
// `synthesisExportEnabled` mirrors the API gate at
// apps/api/src/routes/synthesis-export.ts; when the server flag is off
// the route 404s, so the menu item must not appear.
export function MoreMenu({ base, synthesisExportEnabled = false }: MoreMenuProps) {
  const router = useRouter();
  const t = useTranslations("sidebar");

  const goto = (href: string) => () => {
    router.push(href);
  };

  const external = (href: string) => () => {
    if (typeof window !== "undefined") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("nav.more_aria")}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
      >
        <MoreHorizontal aria-hidden className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onClick={goto(`${base}/settings`)}>
          {t("more_menu.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={goto(`${base}/templates`)}>
          {t("more_menu.templates")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={goto(`${base}/shared-links`)}>
          {t("more_menu.shared_links")}
        </DropdownMenuItem>
        {synthesisExportEnabled ? (
          <DropdownMenuItem onClick={goto(`${base}/synthesis-export`)}>
            {t("more_menu.synthesis_export")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={goto(`${base}/trash`)}>
          {t("more_menu.trash")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={external("/feedback")}>
          {t("more_menu.feedback")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={external("/changelog")}>
          {t("more_menu.changelog")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
