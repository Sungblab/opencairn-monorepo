"use client";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Bell, Settings } from "lucide-react";
import { authClient } from "@/lib/auth-client";

// Bottom row of the sidebar — user identity + shortcut buttons. Billing
// chip (plan + credit balance) isn't wired yet; we surface a single-line
// identity instead until /api/users/me (or its billing replacement) ships.
// Ref: plans-status.md Plan 9b (billing) — add chip once that lands.
export function SidebarFooter() {
  const locale = useLocale();
  const t = useTranslations("sidebar.footer");
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const { data: session, isPending } = authClient.useSession();

  if (isPending || !session) return null;

  const user = session.user;
  const displayName = user.name?.trim() || user.email || t("guest_name");
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
      <Link
        href={`/${locale}/settings/profile`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium"
        >
          {initial}
        </span>
        <span className="truncate text-xs font-medium">{displayName}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={t("notifications_aria")}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
        >
          <Bell aria-hidden className="h-4 w-4" />
        </button>
        <Link
          href={`/${locale}/app/w/${wsSlug}/settings`}
          aria-label={t("settings_aria")}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none"
        >
          <Settings aria-hidden className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
