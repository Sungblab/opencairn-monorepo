"use client";

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
        return <SharedLinksTab />;
      case "trash":
        return <TrashTab />;
    }
  })();

  return (
    <div data-testid="route-ws-settings" className="flex gap-6 p-6">
      <aside className="w-44 shrink-0 border-r border-border pr-4">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </p>
        <nav className="flex flex-col gap-1">
          {TABS.map((id) => (
            <Link
              key={id}
              href={`/${locale}/app/w/${wsSlug}/settings/${SLUGS[id]}`}
              className={`block rounded px-2 py-1 text-sm ${
                current === id
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {t(`tabs.${id}`)}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1">{body}</main>
    </div>
  );
}
