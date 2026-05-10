"use client";

import { useEffect, useState } from "react";
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
      className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-background text-foreground md:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background p-4 md:w-56 md:border-b-0 md:border-r">
        <a
          href={`/${locale}`}
          className="app-btn-ghost mb-4 inline-flex min-h-8 items-center rounded-[var(--radius-control)] px-2 text-xs text-muted-foreground md:mb-6"
        >
          {labels.back}
        </a>
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          {labels.title}
        </p>
        <nav
          aria-label={labels.title}
          className="flex flex-row gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:pb-0"
        >
          {ACCOUNT_TABS.map((id) => (
            <a
              key={id}
              href={`/${locale}/settings/${id}`}
              className={`block shrink-0 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm transition-colors ${
                current === id
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {labels.tabs[id]}
            </a>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 bg-background p-4 sm:p-6">{children}</main>
    </div>
  );
}
