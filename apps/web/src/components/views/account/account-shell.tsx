"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const TABS = ["profile", "providers", "security", "notifications", "billing"] as const;
type TabId = (typeof TABS)[number];

export function AccountShell({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("account");
  const pathname = usePathname() ?? "";
  const current: TabId =
    (TABS.find((id) => pathname.endsWith(`/settings/${id}`)) as TabId) ??
    "profile";

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border p-4">
        <Link
          href={`/${locale}`}
          className="mb-6 block text-xs text-muted-foreground hover:text-foreground"
        >
          {t("back")}
        </Link>
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </p>
        <nav className="flex flex-col gap-1">
          {TABS.map((id) => (
            <Link
              key={id}
              href={`/${locale}/settings/${id}`}
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
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
