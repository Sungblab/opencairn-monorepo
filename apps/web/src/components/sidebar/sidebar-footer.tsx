"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  HelpCircle,
  LogOut,
  User,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { byokKeyQueryKey, getByokKey } from "@/lib/api-client-byok-key";
import { usePanelStore } from "@/stores/panel-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Bottom row of the sidebar — user identity + plan/credit chip + bell. The
// plan label resolves to "BYOK" when the user has a Gemini
// key registered, otherwise "Free". Credits stay at ₩0 until hosted billing
// lands; the subtitle still renders so the layout doesn't shift
// when billing flips on. Mockup ref: docs/mockups/2026-04-23-app-shell
// §sidebar footer.
export function SidebarFooter() {
  const locale = useLocale();
  const t = useTranslations("sidebar.footer");
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const { data: session, isPending } = authClient.useSession();
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

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
  const signOut = () => {
    void authClient.signOut().finally(() => {
      window.location.href = `/${locale}/auth/login`;
    });
  };

  return (
    <div className="flex items-center gap-1.5 border-t border-border px-2 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("profile_menu_aria")}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-none"
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
          <ChevronDown
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[260px] rounded border border-border bg-background p-1 shadow-sm ring-0"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-2">
              <span className="block truncate text-sm font-semibold text-foreground">
                {displayName}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={<Link href={urls.workspace.settings(locale, wsSlug)} />}
            className="min-h-9 rounded px-2 py-2"
          >
            <User aria-hidden className="h-4 w-4" />
            {t("account_settings")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={<a href="/help" target="_blank" rel="noreferrer" />}
            className="min-h-9 rounded px-2 py-2"
          >
            <HelpCircle aria-hidden className="h-4 w-4" />
            {t("help")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={signOut}
            className="min-h-9 rounded px-2 py-2 text-destructive focus:text-destructive"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            {t("sign_out")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t("notifications_aria")}
        onClick={() => openAgentPanelTab("notifications")}
        className="app-btn-ghost h-7 w-7 shrink-0 rounded p-1.5"
      >
        <Bell aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
