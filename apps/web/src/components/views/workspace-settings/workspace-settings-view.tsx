"use client";

import { urls } from "@/lib/urls";
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
      className="flex min-h-full min-w-0 flex-col bg-background md:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background p-4 md:w-60 md:border-b-0 md:border-r">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {tWorkspace("title")}
        </p>
        <nav className="flex flex-row gap-3 overflow-x-auto pb-1 md:flex-col md:gap-4 md:overflow-x-visible md:pb-0">
          {GROUPS.map((group) => (
            <section key={group.id} className="shrink-0 md:shrink">
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase text-muted-foreground">
                {tWorkspace(`groups.${group.id}`)}
              </p>
              <div className="flex flex-row gap-1 md:flex-col">
                {group.items.map((item) => {
                  const active = current === item.id;
                  const t =
                    item.labelNs === "account" ? tAccount : tWorkspace;
                  return (
                    <Link
                      key={item.id}
                      href={sectionHref(locale, wsSlug, item.id)}
                      className={`block shrink-0 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6">{body}</main>
    </div>
  );
}
