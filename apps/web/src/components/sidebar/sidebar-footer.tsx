"use client";
import { urls } from "@/lib/urls";
import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, Settings } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { NotificationDrawer } from "@/components/notifications/notification-drawer";
import { byokKeyQueryKey, getByokKey } from "@/lib/api-client-byok-key";

// Bottom row of the sidebar — user identity + plan/credit chip + bell +
// settings. The plan label resolves to "BYOK" when the user has a Gemini
// key registered, otherwise "Free". Credits stay at ₩0 until hosted billing
// lands; the subtitle still renders so the layout doesn't shift
// when billing flips on. Mockup ref: docs/mockups/2026-04-23-app-shell
// §sidebar footer.
export function SidebarFooter() {
  const locale = useLocale();
  const t = useTranslations("sidebar.footer");
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const { data: session, isPending } = authClient.useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // BYOK status drives the plan label. Long staleTime — the value only
  // changes when the user manually rotates their key in /settings/providers.
  const byok = useQuery({
    queryKey: byokKeyQueryKey(),
    queryFn: getByokKey,
    staleTime: 5 * 60_000,
    enabled: Boolean(session?.user),
  });

  if (isPending || !session) return null;

  const user = session.user;
  const displayName = user.name?.trim() || user.email || t("guest_name");
  const initial = displayName.charAt(0).toUpperCase();
  const planLabel = byok.data?.registered ? t("plan_byok") : t("plan_free");
  const creditsLabel = t("credits_amount", { value: 0 });

  return (
    <>
      <div className="flex items-center gap-1.5 border-t border-border px-2 py-2">
        <Link
          href={`/${locale}/settings/profile`}
          className="app-hover flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1"
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background"
          >
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs leading-tight">{displayName}</div>
            <div className="truncate text-[10px] leading-tight text-muted-foreground">
              {planLabel} · {creditsLabel}
            </div>
          </div>
        </Link>
        <button
          type="button"
          aria-label={t("notifications_aria")}
          onClick={() => setDrawerOpen(true)}
          className="app-btn-ghost h-7 w-7 shrink-0 rounded p-1.5"
        >
          <Bell aria-hidden className="h-3.5 w-3.5" />
        </button>
        <Link
          href={urls.workspace.settings(locale, wsSlug)}
          aria-label={t("settings_aria")}
          className="app-btn-ghost flex h-7 w-7 shrink-0 items-center justify-center rounded p-1.5"
        >
          <Settings aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>
      <NotificationDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}
