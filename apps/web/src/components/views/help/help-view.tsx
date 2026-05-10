"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  BookOpen,
  Bot,
  Bug,
  Code2,
  DownloadCloud,
  FileText,
  GitBranch,
  GraduationCap,
  Network,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { urls } from "@/lib/urls";

const SECTION_KEYS = [
  "start",
  "sources",
  "editor",
  "ai",
  "project",
  "collaboration",
  "automation",
  "settings",
  "troubleshooting",
] as const;
const ITEM_KEYS = {
  start: ["workspace", "project", "firstSource", "tabs"],
  sources: ["upload", "link", "text", "imports"],
  editor: ["notes", "reading", "source", "canvas"],
  ai: ["chat", "scope", "documents", "review"],
  project: ["tree", "graph", "learning", "files"],
  collaboration: ["members", "comments", "sharing", "notifications"],
  automation: ["workflow", "agents", "code", "exports"],
  settings: ["profile", "providers", "integrations", "billing"],
  troubleshooting: ["upload", "evidence", "permissions", "report"],
} as const;
const ACTIONS = [
  { key: "import", icon: DownloadCloud },
  { key: "settings", icon: Settings },
  { key: "report", icon: Bug },
] as const;
const GUIDE_KEYS = ["import", "generate", "collaborate", "learn"] as const;
const GUIDE_ICONS = {
  import: DownloadCloud,
  generate: GitBranch,
  collaborate: Users,
  learn: GraduationCap,
} as const;
const SECTION_ICONS = {
  start: Sparkles,
  sources: DownloadCloud,
  editor: FileText,
  ai: Bot,
  project: Network,
  collaboration: Users,
  automation: Code2,
  settings: Settings,
  troubleshooting: Shield,
} as const;

export function HelpView({ wsSlug }: { wsSlug: string }) {
  const locale = useLocale();
  const t = useTranslations("help");
  const actionHrefs = {
    import: urls.workspace.import(locale, wsSlug),
    settings: urls.workspace.settings(locale, wsSlug),
    report: urls.workspace.report(locale, wsSlug),
  };

  return (
    <div
      data-testid="route-help"
      className="mx-auto flex max-w-6xl flex-col gap-7 px-6 py-7 lg:px-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="max-w-2xl">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-border bg-background">
            <BookOpen aria-hidden className="h-4 w-4 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={t("title")}>
          {ACTIONS.map(({ key, icon: Icon }) => (
            <a
              key={key}
              href={actionHrefs[key]}
              className="app-btn-secondary h-9 rounded-[var(--radius-control)] px-3 text-sm"
            >
              <Icon aria-hidden className="h-4 w-4" />
              {t(`actions.${key}`)}
            </a>
          ))}
        </nav>
      </header>

      <section className="rounded-[var(--radius-card)] border border-border bg-muted/20 p-4">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t("quick.title")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("quick.subtitle")}
            </p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          {GUIDE_KEYS.map((guide) => (
            <GuideCard key={guide} guide={guide} />
          ))}
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-3">
        {SECTION_KEYS.map((section) => (
          <section key={section} className="min-w-0">
            <SectionHeading section={section} />
            <div className="grid gap-2">
              {ITEM_KEYS[section].map((item) => (
                <article
                  key={item}
                  className="rounded-[var(--radius-card)] border border-border bg-background p-3"
                >
                  <h3 className="text-sm font-medium">
                    {t(`sections.${section}.items.${item}.title`)}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {t(`sections.${section}.items.${item}.body`)}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  function GuideCard({ guide }: { guide: (typeof GUIDE_KEYS)[number] }) {
    const Icon = GUIDE_ICONS[guide];
    return (
      <article className="rounded-[var(--radius-card)] border border-border bg-background p-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted/30">
            <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <h3 className="text-sm font-semibold">
            {t(`quick.guides.${guide}.title`)}
          </h3>
        </div>
        <ol className="grid gap-2 text-sm leading-6 text-muted-foreground">
          {[1, 2, 3, 4].map((step) => (
            <li key={step} className="grid grid-cols-[1.5rem_1fr] gap-2">
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {step}
              </span>
              <span>{t(`quick.guides.${guide}.steps.${step}`)}</span>
            </li>
          ))}
        </ol>
      </article>
    );
  }

  function SectionHeading({
    section,
  }: {
    section: (typeof SECTION_KEYS)[number];
  }) {
    const Icon = SECTION_ICONS[section];
    return (
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted/30">
          <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <h2 className="text-sm font-semibold">
          {t(`sections.${section}.title`)}
        </h2>
      </div>
    );
  }
}
