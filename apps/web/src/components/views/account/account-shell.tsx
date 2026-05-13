"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  CreditCard,
  KeyRound,
  PlugZap,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";
import {
  ACCOUNT_TABS,
  type AccountShellLabels,
  type AccountTabId,
} from "./account-shell-config";

function tabFromPath(pathname: string): AccountTabId {
  return (
    ACCOUNT_TABS.find((id) => pathname.endsWith(`/settings/${id}`)) ??
    "profile"
  );
}

const TAB_ICONS: Record<AccountTabId, LucideIcon> = {
  profile: User,
  providers: KeyRound,
  mcp: PlugZap,
  security: Shield,
  notifications: Bell,
  billing: CreditCard,
};

export function AccountShell({
  children,
  labels,
  locale,
}: {
  children: React.ReactNode;
  labels: AccountShellLabels;
  locale: string;
}) {
  const [current, setCurrent] = useState<AccountTabId>("profile");

  useEffect(() => {
    setCurrent(tabFromPath(window.location.pathname));
  }, []);

  return (
    <div
      data-testid="account-shell"
      className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-muted/20 text-foreground lg:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background/95 p-3 shadow-sm lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:p-5 lg:shadow-none">
        <a
          href={`/${locale}`}
          className="app-btn-ghost mb-3 inline-flex min-h-8 items-center rounded-[var(--radius-control)] px-2 text-xs text-muted-foreground lg:mb-5"
        >
          {labels.back}
        </a>
        <div className="mb-3 flex items-center gap-2 px-1 lg:mb-5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted text-foreground">
            <User aria-hidden className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{labels.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {labels.tabs[current]}
            </p>
          </div>
        </div>
        <nav
          aria-label={labels.title}
          className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0"
        >
          {ACCOUNT_TABS.map((id) => {
            const active = current === id;
            const Icon = TAB_ICONS[id];
            return (
              <a
                key={id}
                href={`/${locale}/settings/${id}`}
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
                <span className="whitespace-nowrap">{labels.tabs[id]}</span>
              </a>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
