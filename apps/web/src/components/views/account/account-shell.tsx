"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const TABS = [
  "profile",
  "providers",
  "mcp",
  "security",
  "notifications",
  "billing",
] as const;
type TabId = (typeof TABS)[number];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("account");
  const pathname = usePathname() ?? "";
  const current: TabId =
    (TABS.find((id) => pathname.endsWith(`/settings/${id}`)) as TabId) ??
    "profile";

  return (
    <div
      data-testid="account-shell"
      className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-background text-foreground md:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background p-4 md:w-56 md:border-b-0 md:border-r">
        <Link
          href={`/${locale}`}
          className="app-btn-ghost mb-4 inline-flex min-h-8 items-center rounded-[var(--radius-control)] px-2 text-xs text-muted-foreground md:mb-6"
        >
          {t("back")}
        </Link>
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </p>
        <nav
          aria-label={t("title")}
          className="flex flex-row gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:pb-0"
        >
          {TABS.map((id) => (
            <Link
              key={id}
              href={`/${locale}/settings/${id}`}
              className={`block shrink-0 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm transition-colors ${
                current === id
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t(`tabs.${id}`)}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 bg-background p-4 sm:p-6">{children}</main>
    </div>
  );
}
