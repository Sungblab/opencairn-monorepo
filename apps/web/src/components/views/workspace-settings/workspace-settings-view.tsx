"use client";

import { urls } from "@/lib/urls";
import {
  Bell,
  Cable,
  CreditCard,
  KeyRound,
  Languages,
  Link2,
  Palette,
  PlugZap,
  Settings,
  Shield,
  Trash2,
  User,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ProfileView } from "../account/profile-view";
import { SecurityView } from "../account/security-view";
import { ProvidersView } from "../account/providers-view";
import { NotificationsView } from "../account/notifications-view";
import { BillingView } from "../account/billing-view";
import { AppearanceView } from "../account/appearance-view";
import { LanguageRegionView } from "../account/language-region-view";
import { McpSettingsClientLoader } from "@/components/settings/mcp/McpSettingsClientLoader";
import { MembersTab } from "./members-tab";
import { InvitesTab } from "./invites-tab";
import { IntegrationsTab } from "./integrations-tab";
import { SharedLinksTab } from "./shared-links-tab";
import { TrashTab } from "./trash-tab";

type SettingsSection =
  | "personal/profile"
  | "personal/appearance"
  | "personal/language"
  | "personal/notifications"
  | "personal/security"
  | "ai/providers"
  | "ai/mcp"
  | "workspace/members"
  | "workspace/invites"
  | "workspace/integrations"
  | "workspace/shared-links"
  | "workspace/trash"
  | "billing/plan";

const GROUPS: Array<{
  id: "personal" | "aiTools" | "workspace" | "billing";
  items: Array<{
    id: SettingsSection;
    labelNs: "account" | "workspaceSettings";
    labelKey: string;
  }>;
}> = [
  {
    id: "personal",
    items: [
      { id: "personal/profile", labelNs: "account", labelKey: "tabs.profile" },
      {
        id: "personal/appearance",
        labelNs: "account",
        labelKey: "tabs.appearance",
      },
      {
        id: "personal/language",
        labelNs: "account",
        labelKey: "tabs.language",
      },
      {
        id: "personal/notifications",
        labelNs: "account",
        labelKey: "tabs.notifications",
      },
      { id: "personal/security", labelNs: "account", labelKey: "tabs.security" },
    ],
  },
  {
    id: "aiTools",
    items: [
      { id: "ai/providers", labelNs: "account", labelKey: "tabs.providers" },
      { id: "ai/mcp", labelNs: "account", labelKey: "tabs.mcp" },
    ],
  },
  {
    id: "workspace",
    items: [
      {
        id: "workspace/members",
        labelNs: "workspaceSettings",
        labelKey: "tabs.members",
      },
      {
        id: "workspace/invites",
        labelNs: "workspaceSettings",
        labelKey: "tabs.invites",
      },
      {
        id: "workspace/integrations",
        labelNs: "workspaceSettings",
        labelKey: "tabs.integrations",
      },
      {
        id: "workspace/shared-links",
        labelNs: "workspaceSettings",
        labelKey: "tabs.sharedLinks",
      },
      {
        id: "workspace/trash",
        labelNs: "workspaceSettings",
        labelKey: "tabs.trash",
      },
    ],
  },
  {
    id: "billing",
    items: [{ id: "billing/plan", labelNs: "account", labelKey: "tabs.billing" }],
  },
];

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  "personal/profile": User,
  "personal/appearance": Palette,
  "personal/language": Languages,
  "personal/notifications": Bell,
  "personal/security": Shield,
  "ai/providers": KeyRound,
  "ai/mcp": PlugZap,
  "workspace/members": Users,
  "workspace/invites": UserPlus,
  "workspace/integrations": Cable,
  "workspace/shared-links": Link2,
  "workspace/trash": Trash2,
  "billing/plan": CreditCard,
};

function sectionFromPath(path: string[] | undefined, legacySub?: string) {
  const parts = path?.length ? path : legacySub ? [legacySub] : [];
  const joined = parts.join("/");
  switch (joined) {
    case "":
      return "personal/profile";
    case "profile":
    case "personal/profile":
      return "personal/profile";
    case "appearance":
    case "personal/appearance":
      return "personal/appearance";
    case "language":
    case "personal/language":
      return "personal/language";
    case "notifications":
    case "personal/notifications":
      return "personal/notifications";
    case "security":
    case "personal/security":
      return "personal/security";
    case "providers":
    case "ai":
    case "ai/providers":
      return "ai/providers";
    case "mcp":
    case "ai/mcp":
      return "ai/mcp";
    case "members":
    case "workspace/members":
      return "workspace/members";
    case "invites":
    case "workspace/invites":
      return "workspace/invites";
    case "integrations":
    case "workspace/integrations":
      return "workspace/integrations";
    case "shared-links":
    case "workspace/shared-links":
      return "workspace/shared-links";
    case "trash":
    case "workspace/trash":
      return "workspace/trash";
    case "billing":
    case "billing/plan":
      return "billing/plan";
    default:
      return "personal/profile";
  }
}

function sectionHref(locale: string, wsSlug: string, section: SettingsSection) {
  const [first, second] = section.split("/") as [string, string];
  return urls.workspace.settingsSection(locale, wsSlug, first, second);
}

export interface WorkspaceSettingsViewProps {
  wsSlug: string;
  wsId: string;
  sub?: string;
  path?: string[];
}

export function WorkspaceSettingsView({
  wsSlug,
  wsId,
  sub,
  path,
}: WorkspaceSettingsViewProps) {
  const locale = useLocale();
  const tWorkspace = useTranslations("workspaceSettings");
  const tAccount = useTranslations("account");
  const current = sectionFromPath(path, sub);
  const currentItem = GROUPS.flatMap((group) => group.items).find(
    (item) => item.id === current,
  );
  const currentTitle =
    currentItem?.labelNs === "workspaceSettings"
      ? tWorkspace(currentItem.labelKey)
      : currentItem
        ? tAccount(currentItem.labelKey)
        : tWorkspace("title");

  const body = (() => {
    switch (current) {
      case "personal/profile":
        return <ProfileView />;
      case "personal/appearance":
        return <AppearanceView />;
      case "personal/language":
        return <LanguageRegionView />;
      case "personal/notifications":
        return <NotificationsView />;
      case "personal/security":
        return <SecurityView />;
      case "ai/providers":
        return <ProvidersView />;
      case "ai/mcp":
        return <McpSettingsClientLoader />;
      case "workspace/members":
        return <MembersTab wsId={wsId} />;
      case "workspace/invites":
        return <InvitesTab wsId={wsId} />;
      case "workspace/integrations":
        return <IntegrationsTab wsId={wsId} />;
      case "workspace/shared-links":
        return <SharedLinksTab wsId={wsId} />;
      case "workspace/trash":
        return <TrashTab wsId={wsId} />;
      case "billing/plan":
        return <BillingView />;
    }
  })();

  return (
    <div
      data-testid="route-ws-settings"
      className="flex min-h-full min-w-0 flex-col bg-muted/20 text-foreground lg:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background/95 p-3 shadow-sm lg:sticky lg:top-0 lg:h-full lg:w-72 lg:border-b-0 lg:border-r lg:p-5 lg:shadow-none">
        <div className="mb-3 flex items-center gap-2 px-1 lg:mb-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted text-foreground">
            <Settings aria-hidden className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{tWorkspace("title")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {currentTitle}
            </p>
          </div>
        </div>
        <nav className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:gap-5 lg:overflow-x-visible lg:pb-0">
          {GROUPS.map((group) => (
            <section key={group.id} className="shrink-0 lg:shrink">
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase text-muted-foreground">
                {tWorkspace(`groups.${group.id}`)}
              </p>
              <div className="flex gap-1 lg:flex-col">
                {group.items.map((item) => {
                  const active = current === item.id;
                  const t =
                    item.labelNs === "account" ? tAccount : tWorkspace;
                  const Icon = SECTION_ICONS[item.id];
                  return (
                    <Link
                      key={item.id}
                      href={sectionHref(locale, wsSlug, item.id)}
                      aria-current={active ? "page" : undefined}
                      className={`group inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-colors lg:w-full ${
                        active
                          ? "border-foreground/15 bg-foreground text-background shadow-sm"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon
                        aria-hidden
                        className={`h-4 w-4 shrink-0 ${
                          active
                            ? "text-background"
                            : "text-muted-foreground group-hover:text-foreground"
                        }`}
                      />
                      <span className="whitespace-nowrap">{t(item.labelKey)}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-5xl">{body}</div>
      </main>
    </div>
  );
}
