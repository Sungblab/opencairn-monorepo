"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DriveTab } from "./DriveTab";
import { MarkdownTab } from "./MarkdownTab";
import { NotionTab } from "./NotionTab";

const TABS = ["drive", "markdown", "more"] as const;
type TabId = (typeof TABS)[number];

export function ImportTabs({ wsSlug }: { wsSlug: string }) {
  const t = useTranslations("import.tabs");
  const [tab, setTab] = useState<TabId>("drive");
  return (
    <div className="mt-6">
      <div role="tablist" className="flex gap-2 border-b border-border">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(id)}
          >
            {t(id)}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "drive" ? (
          <DriveTab wsSlug={wsSlug} />
        ) : tab === "markdown" ? (
          <MarkdownTab wsSlug={wsSlug} />
        ) : (
          <NotionTab wsSlug={wsSlug} />
        )}
      </div>
    </div>
  );
}
