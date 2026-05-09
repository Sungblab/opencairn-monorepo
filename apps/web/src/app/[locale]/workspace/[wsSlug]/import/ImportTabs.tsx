"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DriveTab } from "./DriveTab";
import { MarkdownTab } from "./MarkdownTab";
import { NotionTab } from "./NotionTab";
import { FirstSourceIntake } from "@/components/import/first-source-intake";

const TABS = ["file", "link", "text", "more"] as const;
type TabId = (typeof TABS)[number];

export function ImportTabs({ wsSlug }: { wsSlug: string }) {
  const t = useTranslations("import.tabs");
  const tLegacy = useTranslations("import.legacy");
  const [tab, setTab] = useState<TabId>("file");
  const [legacyTab, setLegacyTab] = useState<"drive" | "markdown" | "notion">(
    "drive",
  );
  return (
    <div className="mt-6">
      <div role="tablist" aria-label={t("label")} className="flex gap-2 border-b border-border">
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
        {tab === "file" || tab === "link" || tab === "text" ? (
          <FirstSourceIntake
            wsSlug={wsSlug}
            initialMode={tab}
            showModeTabs={false}
          />
        ) : null}
        {tab === "more" ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-background p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold">{tLegacy("title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tLegacy("description")}
              </p>
            </div>
            <div
              role="tablist"
              aria-label={tLegacy("label")}
              className="flex flex-wrap gap-2 border-b border-border"
            >
              {(["drive", "markdown", "notion"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={legacyTab === id}
                  className={`min-h-10 rounded-t px-3 text-sm font-medium transition ${
                    legacyTab === id
                      ? "border-b-2 border-primary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setLegacyTab(id)}
                >
                  {tLegacy(`tabs.${id}`)}
                </button>
              ))}
            </div>
            <div className="mt-5">
              {legacyTab === "drive" ? <DriveTab wsSlug={wsSlug} /> : null}
              {legacyTab === "markdown" ? <MarkdownTab wsSlug={wsSlug} /> : null}
              {legacyTab === "notion" ? <NotionTab wsSlug={wsSlug} /> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
