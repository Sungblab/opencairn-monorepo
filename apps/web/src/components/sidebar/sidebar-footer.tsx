"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Check,
  HelpCircle,
  LogOut,
  Settings,
  Shield,
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

type WorkspaceRole = "owner" | "admin" | "member" | "guest";

interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
}

interface MyInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  expiresAt: string;
}

interface MyResponse {
  workspaces: MyWorkspace[];
  invites: MyInvite[];
}

interface AuthMeResponse {
  isSiteAdmin: boolean;
}

// Bottom row of the sidebar: current workspace context, account menu, and bell.
// BYOK status drives the plan label when the user has a Gemini key registered.
export function SidebarFooter() {
  const locale = useLocale();
  const router = useRouter();
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

  const authMe = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async (): Promise<AuthMeResponse> => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error(`auth/me ${res.status}`);
      return (await res.json()) as AuthMeResponse;
    },
    staleTime: 30_000,
    enabled: Boolean(session?.user),
  });

  const workspaces = useQuery({
    queryKey: ["workspaces", "me"],
    queryFn: async (): Promise<MyResponse> => {
      const res = await fetch("/api/workspaces/me", { credentials: "include" });
      if (!res.ok) throw new Error(`workspaces/me ${res.status}`);
      return (await res.json()) as MyResponse;
    },
    staleTime: 30_000,
    enabled: Boolean(session?.user),
  });

  if (isPending || !session) return null;

  const user = session.user as typeof session.user & {
    isSiteAdmin?: boolean;
  };
  const isSiteAdmin = Boolean(user.isSiteAdmin || authMe.data?.isSiteAdmin);
  const planLabel = byok.data?.registered ? t("plan_byok") : t("plan_free");
  const currentWorkspace =
    workspaces.data?.workspaces.find((w) => w.slug === wsSlug) ??
    workspaces.data?.workspaces[0];
  const workspaceName = currentWorkspace?.name ?? t("workspace_loading");
  const workspaceInitial = workspaceName.trim().charAt(0).toUpperCase() || "·";
  const avatarUrl =
    typeof user.image === "string" && user.image.trim().length > 0
      ? user.image.trim()
      : null;
  const currentWorkspaceSlug = currentWorkspace?.slug ?? wsSlug;
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
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-none"
        >
          {avatarUrl ? (
            <img
              alt=""
              src={avatarUrl}
              className="h-7 w-7 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background"
            >
              {workspaceInitial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs leading-tight">
              {workspaceName}
            </div>
            <div className="truncate text-[10px] leading-tight text-muted-foreground">
              {planLabel}
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
          className="w-[260px] rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-2">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("current_space")}
              </span>
              <span className="block truncate text-sm font-semibold text-foreground">
                {workspaceName}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {planLabel}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {currentWorkspaceSlug ? (
            <DropdownMenuItem
              render={
                <Link
                  href={urls.workspace.settings(locale, currentWorkspaceSlug)}
                />
              }
              className="min-h-9 rounded px-2 py-2"
            >
              <Settings aria-hidden className="h-4 w-4" />
              {t("workspace_settings")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            render={<Link href={urls.settings.profile(locale)} />}
            className="min-h-9 rounded px-2 py-2"
          >
            <User aria-hidden className="h-4 w-4" />
            {t("account_settings")}
          </DropdownMenuItem>
          {isSiteAdmin ? (
            <DropdownMenuItem
              render={<Link href={`/${locale}/admin`} />}
              className="min-h-9 rounded px-2 py-2"
            >
              <Shield aria-hidden className="h-4 w-4" />
              {t("admin_console")}
            </DropdownMenuItem>
          ) : null}
          {workspaces.data?.workspaces.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-wide">
                  {t("switch_space")}
                </DropdownMenuLabel>
                {workspaces.data.workspaces.map((workspace) => {
                  const active = workspace.slug === currentWorkspaceSlug;

                  return (
                    <DropdownMenuItem
                      key={workspace.id}
                      onClick={() =>
                        router.push(
                          urls.workspace.root(locale, workspace.slug),
                        )
                      }
                      className="flex min-h-9 items-center justify-between gap-2 rounded px-2 py-2"
                    >
                      <span className="min-w-0 truncate">{workspace.name}</span>
                      {active ? (
                        <Check
                          aria-label={t("active_space")}
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            render={
              <Link
                href={
                  currentWorkspaceSlug
                    ? urls.workspace.help(locale, currentWorkspaceSlug)
                    : `/${locale}/help`
                }
              />
            }
            className="min-h-9 rounded px-2 py-2"
          >
            <HelpCircle aria-hidden className="h-4 w-4" />
            {t("help")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href={
                  currentWorkspaceSlug
                    ? urls.workspace.report(locale, currentWorkspaceSlug)
                    : `/${locale}/report`
                }
              />
            }
            className="min-h-9 rounded px-2 py-2"
          >
            <AlertTriangle aria-hidden className="h-4 w-4" />
            {t("report_issue")}
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
        className="app-btn-ghost h-7 w-7 shrink-0 rounded-[var(--radius-control)] p-1.5"
      >
        <Bell aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
