"use client";

import { urls } from "@/lib/urls";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { MembersTab } from "./members-tab";
import { InvitesTab } from "./invites-tab";
import { IntegrationsTab } from "./integrations-tab";
import { SharedLinksTab } from "./shared-links-tab";
import { TrashTab } from "./trash-tab";

const TABS = [
  "members",
  "invites",
  "integrations",
  "sharedLinks",
  "trash",
] as const;
type TabId = (typeof TABS)[number];

const SLUGS: Record<TabId, string> = {
  members: "members",
  invites: "invites",
  integrations: "integrations",
  sharedLinks: "shared-links",
  trash: "trash",
};

function tabFromSlug(slug: string): TabId {
  switch (slug) {
    case "members":
      return "members";
    case "invites":
      return "invites";
    case "integrations":
      return "integrations";
    case "shared-links":
      return "sharedLinks";
    case "trash":
      return "trash";
    default:
      return "members";
  }
}

export function WorkspaceSettingsView({
  wsSlug,
  wsId,
  sub,
}: {
  wsSlug: string;
  wsId: string;
  sub: string;
}) {
  const locale = useLocale();
  const t = useTranslations("workspaceSettings");
  const current = tabFromSlug(sub);

  const body = (() => {
    switch (current) {
      case "members":
        return <MembersTab wsId={wsId} />;
      case "invites":
        return <InvitesTab wsId={wsId} />;
      case "integrations":
        return <IntegrationsTab wsId={wsId} />;
      case "sharedLinks":
        return <SharedLinksTab wsId={wsId} />;
      case "trash":
        return <TrashTab wsId={wsId} />;
    }
  })();

  return (
    <div
      data-testid="route-ws-settings"
      className="flex min-h-full min-w-0 flex-col bg-background md:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-[var(--theme-surface)] p-4 md:w-48 md:border-b-0 md:border-r">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </p>
        <nav className="flex flex-row gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:pb-0">
          {TABS.map((id) => (
            <Link
              key={id}
              href={urls.workspace.settingsSection(locale, wsSlug, SLUGS[id])}
              className={`block shrink-0 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm transition-colors ${
                current === id
                  ? "bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t(`tabs.${id}`)}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-6">{body}</main>
    </div>
  );
}
