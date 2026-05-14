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
  Palette,
  Settings,
  Shield,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { byokKeyQueryKey, getByokKey } from "@/lib/api-client-byok-key";
import { useTheme } from "@/lib/theme/provider";
import { THEME_LABELS, type Theme } from "@/lib/theme/themes";
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
type UserPlan = "free" | "pro" | "max" | "byok";

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

interface MyBillingSummary {
  plan: UserPlan;
  balanceCredits: number;
  monthlyGrantCredits: number;
  managedLlm: boolean;
}

interface MyResponse {
  workspaces: MyWorkspace[];
  invites: MyInvite[];
  billing?: MyBillingSummary;
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
  const appearanceT = useTranslations("account.appearance");
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const { data: session, isPending } = authClient.useSession();
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);
  const { theme, themes, setTheme } = useTheme();

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
  const billing = workspaces.data?.billing;
  const planLabel = billing
    ? t(planLabelKey(billing.plan))
    : byok.data?.registered
      ? t("plan_byok")
      : t("plan_free");
  const creditLabel = billing?.managedLlm
    ? t("credits_remaining", {
        credits: new Intl.NumberFormat(locale).format(
          Math.max(0, billing.balanceCredits),
        ),
      })
    : null;
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
            <div className="flex min-w-0 items-center gap-1 truncate text-[10px] leading-tight text-muted-foreground">
              <span className="truncate">{planLabel}</span>
              {creditLabel ? (
                <>
                  <span aria-hidden className="shrink-0">
                    ·
                  </span>
                  <span className="truncate">{creditLabel}</span>
                </>
              ) : null}
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
              {creditLabel ? (
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  {creditLabel}
                </span>
              ) : null}
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
              {t("settings_aria")}
            </DropdownMenuItem>
          ) : null}
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
              {t("rename_workspace")}
            </DropdownMenuItem>
          ) : null}
          {isSiteAdmin ? (
            <DropdownMenuItem
              render={<Link href={`/${locale}/admin`} />}
              className="min-h-9 rounded px-2 py-2"
            >
              <Shield aria-hidden className="h-4 w-4" />
              {t("admin_console")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {workspaces.data?.workspaces.length ? (
            <>
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
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-wide">
              {t("theme")}
            </DropdownMenuLabel>
            <div className="grid grid-cols-4 gap-1 px-1 pb-1">
              {themes.map((themeId) => (
                <ThemeMenuItem
                  key={themeId}
                  id={themeId}
                  active={themeId === theme}
                  label={THEME_LABELS[themeId]}
                  description={appearanceT(`themes.${themeId}`)}
                  activeLabel={t("active_theme")}
                  onSelect={setTheme}
                />
              ))}
            </div>
          </DropdownMenuGroup>
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

function planLabelKey(plan: UserPlan) {
  switch (plan) {
    case "pro":
      return "plan_pro";
    case "max":
      return "plan_max";
    case "byok":
      return "plan_byok";
    case "free":
    default:
      return "plan_free";
  }
}

function ThemeMenuItem({
  id,
  active,
  label,
  description,
  activeLabel,
  onSelect,
}: {
  id: Theme;
  active: boolean;
  label: string;
  description: string;
  activeLabel: string;
  onSelect: (theme: Theme) => void;
}) {
  return (
    <button
      type="button"
      aria-label={
        active
          ? `${label}, ${description}, ${activeLabel}`
          : `${label}, ${description}`
      }
      onClick={() => onSelect(id)}
      className="relative grid min-h-12 place-items-center rounded px-1 py-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
      title={label}
    >
      <ThemeSwatch id={id} />
      {active ? (
        <Check
          aria-label={activeLabel}
          className="absolute right-1 top-1 h-3 w-3 shrink-0 text-foreground"
        />
      ) : null}
      <span className="mt-1 max-w-full truncate text-[10px] leading-none">
        {label.replace("Cairn ", "")}
      </span>
    </button>
  );
}

function ThemeSwatch({ id }: { id: Theme }) {
  const swatches: Record<Theme, string> = {
    "cairn-light": "bg-white",
    "cairn-dark": "bg-neutral-950",
    sepia: "bg-amber-100",
    "high-contrast": "bg-yellow-300",
  };
  const accents: Record<Theme, string> = {
    "cairn-light": "bg-neutral-900",
    "cairn-dark": "bg-neutral-100",
    sepia: "bg-stone-700",
    "high-contrast": "bg-black",
  };

  return (
    <span
      aria-hidden
      className={`relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border ${swatches[id]}`}
    >
      <span
        className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-tl-full ${accents[id]}`}
      />
      {id === "high-contrast" ? (
        <Palette className="absolute left-0.5 top-0.5 h-3 w-3 text-black" />
      ) : null}
    </span>
  );
}
